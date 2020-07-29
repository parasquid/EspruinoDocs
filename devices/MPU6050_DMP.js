
/* ============================================
Copyright (c) 2016 Dan Oprescu
Adds Digital Motion Processing options for the Invensense MPU6050 digital gyro + accelerometer sensor.

The module is partly based on the Arduino library for MPU6050 and I2Cdev
written by Jeff Rowberg and placed under the MIT license
Copyright (c) 2012 Jeff Rowberg

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
=============================================== */


/* Module constants*/
var C = {
  CLOCK_PLL_ZGYRO     : 0x03,

  GYRO_FS_250         : 0x00,
  GYRO_FS_500         : 0x01,
  GYRO_FS_1000        : 0x02,
  GYRO_FS_2000        : 0x03,

  ACCEL_FS_2          : 0x00,
  ACCEL_FS_4          : 0x01,
  ACCEL_FS_8          : 0x02,
  ACCEL_FS_16         : 0x03,

  EXT_SYNC_SET_BIT      : 5,
  EXT_SYNC_SET_LENGTH   : 3,
  EXT_SYNC_TEMP_OUT_L   : 0x1,

  DLPF_CFG_BIT      : 2,
  DLPF_CFG_LENGTH   : 3,
  DLPF_BW_256       : 0x00,
  DLPF_BW_188       : 0x01,
  DLPF_BW_98        : 0x02,
  DLPF_BW_42        : 0x03,
  DLPF_BW_20        : 0x04,
  DLPF_BW_10        : 0x05,
  DLPF_BW_5         : 0x06,

  USERCTRL_DMP_EN_BIT     : 7,
  USERCTRL_FIFO_EN_BIT    : 6,
  USERCTRL_I2C_MST_EN_BIT : 5,
  USERCTRL_DMP_RESET_BIT  : 3,
  USERCTRL_FIFO_RESET_BIT : 2,
  USERCTRL_I2C_MST_RESET_BIT : 1
};

/* Register addresses*/
var R = {
  SMPLRT_DIV          : 0x19,
  CONFIG              : 0x1A,
  MOT_THR             : 0x1F,
  MOT_DUR             : 0x20,
  ZRMOT_THR           : 0x21,
  ZRMOT_DUR           : 0x22,
  FIFO_EN             : 0x23,
  INT_PIN_CFG         : 0x37,
  INT_ENABLE          : 0x38,
  INT_STATUS          : 0x3A,
  USER_CTRL           : 0x6A,
  DMP_CFG_1           : 0x70,
  DMP_CFG_2           : 0x71,
  FIFO_COUNT_H        : 0x72,
  FIFO_COUNT_L        : 0x73,
  FIFO_R_W            : 0x74,
  WHO_AM_I            : 0x75
};


exports.create = function (_mpu6050, _fifoRate) {
  return new DMP(_mpu6050, _fifoRate);
};


/** DMP Object
 * @fifoRate DMP output frequency = 200Hz / (1 + fifoRate)
 * Going faster than 100Hz (0x00=200Hz) tends to result in very noisy data.
 * It is important to make sure the host processor can keep up with reading and processing
 * the FIFO output at the desired rate.
 * Handling FIFO overflow cleanly is also a good idea.
*/
function DMP(_mpu6050, _fifoRate, debug) {
  this.mpu = _mpu6050;
  this.fifoRate = _fifoRate;
  this.debug = debug;
  this.initialize();
}

var PACKET_SIZE = 42;

// Returns the Quaternion, Acceleration and Gyro in 1 object
DMP.prototype.getData = function() {
  var status = this.getIntStatus();
  var fifoCount = this.getFIFOCount();

  // check for overflow (this should never happen unless our code is too inefficient
  if ((status & 0x10) || fifoCount == 1024) {
    // reset so we can continue cleanly
    this.resetFIFO();
    if (this.debug) console.log("FIFO overflow!");
    return undefined;
  } else if (status & 0x02) { // otherwise, check for DMP data ready interrupt (this should happen frequently)
    // wait for correct available data length, should be a VERY short wait
    while (fifoCount < PACKET_SIZE) fifoCount = DMP.getFIFOCount();

    var packet = this.getFIFOBytes(PACKET_SIZE);
    // console.log(args.time + " - STATUS: " + status + " Count: " + fifoCount + " FIFO: ");

    // data comes on 4 bytes for each element, but we can ignore the 2 least significant ones
    return {  qw: signedInt(packet[0], packet[1]) / 16384.0,
              qx: signedInt(packet[4], packet[5]) / 16384.0,
              qy: signedInt(packet[8], packet[9]) / 16384.0,
              qz: signedInt(packet[12], packet[13]) / 16384.0,

              gyrox: signedInt(packet[16], packet[17]),
              gyroy: signedInt(packet[20], packet[21]),
              gyroz: signedInt(packet[24], packet[25]),

              accelx: signedInt(packet[28], packet[29]),
              accely: signedInt(packet[32], packet[33]),
              accelz: signedInt(packet[36], packet[37])  };
  }

  console.log("DMP Data NOT ready");
  return undefined;
}

var signedInt = function(uint8Value1, uint8Value2) {
  var res = (uint8Value1 << 8) | uint8Value2;
  if(res > 32768) res = res - 65536;
  return res;
}

DMP.prototype.getGravity = function(data) {
  return {  x: 2 * (data.qx * data.qz - data.qw * data.qy),
            y: 2 * (data.qw * data.qx + data.qy * data.qz),
            z: data.qw * data.qw - data.qx * data.qx - data.qy * data.qy + data.qz * data.qz }
}

DMP.prototype.getYawPitchRoll = function(data) {
  var gravity = this.getGravity(data);
  // yaw = Z axis, pitch = Y axis, roll = X axis
  return {  yaw: Math.atan2(2 * data.qx * data.qy - 2 * data.qw * data.qz, 2 * data.qw * data.qw + 2 * data.qx * data.qx - 1),
            pitch: Math.atan(gravity.x / Math.sqrt(gravity.y * gravity.y + gravity.z * gravity.z)),
            roll: Math.atan(gravity.y / Math.sqrt(gravity.x * gravity.x + gravity.z * gravity.z)) };
}

DMP.prototype.getEuler = function(data) {
  return {  psi: Math.atan2(2 * data.qx * data.qy - 2 * data.qw * data.qz, 2 * data.qw * data.qw + 2 * data.qx * data.qx - 1),
            theta: -Math.asin(2 * data.qx * data.qz + 2 * data.qw * data.qy),
            phi: Math.atan2(2 * data.qy * data.qz - 2 * data.qw * data.qx, 2 * data.qw * data.qw + 2 * data.qz * data.qz - 1) };
}


/*var DMP_MEMORY = new Uint8Array([
    // bank 0, 256 bytes
    0xFB, 0x00, 0x00, 0x3E, 0x00, 0x0B, 0x00, 0x36, 0x00, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00,
    0x00, 0x65, 0x00, 0x54, 0xFF, 0xEF, 0x00, 0x00, 0xFA, 0x80, 0x00, 0x0B, 0x12, 0x82, 0x00, 0x01,
    0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x28, 0x00, 0x00, 0xFF, 0xFF, 0x45, 0x81, 0xFF, 0xFF, 0xFA, 0x72, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x03, 0xE8, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x7F, 0xFF, 0xFF, 0xFE, 0x80, 0x01,
    0x00, 0x1B, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x3E, 0x03, 0x30, 0x40, 0x00, 0x00, 0x00, 0x02, 0xCA, 0xE3, 0x09, 0x3E, 0x80, 0x00, 0x00,
    0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x60, 0x00, 0x00, 0x00,
    0x41, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x0B, 0x2A, 0x00, 0x00, 0x16, 0x55, 0x00, 0x00, 0x21, 0x82,
    0xFD, 0x87, 0x26, 0x50, 0xFD, 0x80, 0x00, 0x00, 0x00, 0x1F, 0x00, 0x00, 0x00, 0x05, 0x80, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00,
    0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x6F, 0x00, 0x02, 0x65, 0x32, 0x00, 0x00, 0x5E, 0xC0,
    0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0xFB, 0x8C, 0x6F, 0x5D, 0xFD, 0x5D, 0x08, 0xD9, 0x00, 0x7C, 0x73, 0x3B, 0x00, 0x6C, 0x12, 0xCC,
    0x32, 0x00, 0x13, 0x9D, 0x32, 0x00, 0xD0, 0xD6, 0x32, 0x00, 0x08, 0x00, 0x40, 0x00, 0x01, 0xF4,
    0xFF, 0xE6, 0x80, 0x79, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xD0, 0xD6, 0x00, 0x00, 0x27, 0x10,

    // bank 1, 256 bytes
    0xFB, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00,
    0x00, 0x00, 0xFA, 0x36, 0xFF, 0xBC, 0x30, 0x8E, 0x00, 0x05, 0xFB, 0xF0, 0xFF, 0xD9, 0x5B, 0xC8,
    0xFF, 0xD0, 0x9A, 0xBE, 0x00, 0x00, 0x10, 0xA9, 0xFF, 0xF4, 0x1E, 0xB2, 0x00, 0xCE, 0xBB, 0xF7,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x04, 0x00, 0x02, 0x00, 0x02, 0x02, 0x00, 0x00, 0x0C,
    0xFF, 0xC2, 0x80, 0x00, 0x00, 0x01, 0x80, 0x00, 0x00, 0xCF, 0x80, 0x00, 0x40, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x14,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x03, 0x3F, 0x68, 0xB6, 0x79, 0x35, 0x28, 0xBC, 0xC6, 0x7E, 0xD1, 0x6C,
    0x80, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0xB2, 0x6A, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x3F, 0xF0, 0x00, 0x00, 0x00, 0x30,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x25, 0x4D, 0x00, 0x2F, 0x70, 0x6D, 0x00, 0x00, 0x05, 0xAE, 0x00, 0x0C, 0x02, 0xD0,

    // bank 2, 256 bytes
    0x00, 0x00, 0x00, 0x00, 0x00, 0x65, 0x00, 0x54, 0xFF, 0xEF, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x01, 0x00, 0x00, 0x44, 0x00, 0x00, 0x00, 0x00, 0x0C, 0x00, 0x00, 0x00, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x65, 0x00, 0x00, 0x00, 0x54, 0x00, 0x00, 0xFF, 0xEF, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x1B, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00,
    0x00, 0x1B, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,

    // bank 3, 256 bytes
    0xD8, 0xDC, 0xBA, 0xA2, 0xF1, 0xDE, 0xB2, 0xB8, 0xB4, 0xA8, 0x81, 0x91, 0xF7, 0x4A, 0x90, 0x7F,
    0x91, 0x6A, 0xF3, 0xF9, 0xDB, 0xA8, 0xF9, 0xB0, 0xBA, 0xA0, 0x80, 0xF2, 0xCE, 0x81, 0xF3, 0xC2,
    0xF1, 0xC1, 0xF2, 0xC3, 0xF3, 0xCC, 0xA2, 0xB2, 0x80, 0xF1, 0xC6, 0xD8, 0x80, 0xBA, 0xA7, 0xDF,
    0xDF, 0xDF, 0xF2, 0xA7, 0xC3, 0xCB, 0xC5, 0xB6, 0xF0, 0x87, 0xA2, 0x94, 0x24, 0x48, 0x70, 0x3C,
    0x95, 0x40, 0x68, 0x34, 0x58, 0x9B, 0x78, 0xA2, 0xF1, 0x83, 0x92, 0x2D, 0x55, 0x7D, 0xD8, 0xB1,
    0xB4, 0xB8, 0xA1, 0xD0, 0x91, 0x80, 0xF2, 0x70, 0xF3, 0x70, 0xF2, 0x7C, 0x80, 0xA8, 0xF1, 0x01,
    0xB0, 0x98, 0x87, 0xD9, 0x43, 0xD8, 0x86, 0xC9, 0x88, 0xBA, 0xA1, 0xF2, 0x0E, 0xB8, 0x97, 0x80,
    0xF1, 0xA9, 0xDF, 0xDF, 0xDF, 0xAA, 0xDF, 0xDF, 0xDF, 0xF2, 0xAA, 0xC5, 0xCD, 0xC7, 0xA9, 0x0C,
    0xC9, 0x2C, 0x97, 0x97, 0x97, 0x97, 0xF1, 0xA9, 0x89, 0x26, 0x46, 0x66, 0xB0, 0xB4, 0xBA, 0x80,
    0xAC, 0xDE, 0xF2, 0xCA, 0xF1, 0xB2, 0x8C, 0x02, 0xA9, 0xB6, 0x98, 0x00, 0x89, 0x0E, 0x16, 0x1E,
    0xB8, 0xA9, 0xB4, 0x99, 0x2C, 0x54, 0x7C, 0xB0, 0x8A, 0xA8, 0x96, 0x36, 0x56, 0x76, 0xF1, 0xB9,
    0xAF, 0xB4, 0xB0, 0x83, 0xC0, 0xB8, 0xA8, 0x97, 0x11, 0xB1, 0x8F, 0x98, 0xB9, 0xAF, 0xF0, 0x24,
    0x08, 0x44, 0x10, 0x64, 0x18, 0xF1, 0xA3, 0x29, 0x55, 0x7D, 0xAF, 0x83, 0xB5, 0x93, 0xAF, 0xF0,
    0x00, 0x28, 0x50, 0xF1, 0xA3, 0x86, 0x9F, 0x61, 0xA6, 0xDA, 0xDE, 0xDF, 0xD9, 0xFA, 0xA3, 0x86,
    0x96, 0xDB, 0x31, 0xA6, 0xD9, 0xF8, 0xDF, 0xBA, 0xA6, 0x8F, 0xC2, 0xC5, 0xC7, 0xB2, 0x8C, 0xC1,
    0xB8, 0xA2, 0xDF, 0xDF, 0xDF, 0xA3, 0xDF, 0xDF, 0xDF, 0xD8, 0xD8, 0xF1, 0xB8, 0xA8, 0xB2, 0x86,

    // bank 4, 256 bytes
    0xB4, 0x98, 0x0D, 0x35, 0x5D, 0xB8, 0xAA, 0x98, 0xB0, 0x87, 0x2D, 0x35, 0x3D, 0xB2, 0xB6, 0xBA,
    0xAF, 0x8C, 0x96, 0x19, 0x8F, 0x9F, 0xA7, 0x0E, 0x16, 0x1E, 0xB4, 0x9A, 0xB8, 0xAA, 0x87, 0x2C,
    0x54, 0x7C, 0xB9, 0xA3, 0xDE, 0xDF, 0xDF, 0xA3, 0xB1, 0x80, 0xF2, 0xC4, 0xCD, 0xC9, 0xF1, 0xB8,
    0xA9, 0xB4, 0x99, 0x83, 0x0D, 0x35, 0x5D, 0x89, 0xB9, 0xA3, 0x2D, 0x55, 0x7D, 0xB5, 0x93, 0xA3,
    0x0E, 0x16, 0x1E, 0xA9, 0x2C, 0x54, 0x7C, 0xB8, 0xB4, 0xB0, 0xF1, 0x97, 0x83, 0xA8, 0x11, 0x84,
    0xA5, 0x09, 0x98, 0xA3, 0x83, 0xF0, 0xDA, 0x24, 0x08, 0x44, 0x10, 0x64, 0x18, 0xD8, 0xF1, 0xA5,
    0x29, 0x55, 0x7D, 0xA5, 0x85, 0x95, 0x02, 0x1A, 0x2E, 0x3A, 0x56, 0x5A, 0x40, 0x48, 0xF9, 0xF3,
    0xA3, 0xD9, 0xF8, 0xF0, 0x98, 0x83, 0x24, 0x08, 0x44, 0x10, 0x64, 0x18, 0x97, 0x82, 0xA8, 0xF1,
    0x11, 0xF0, 0x98, 0xA2, 0x24, 0x08, 0x44, 0x10, 0x64, 0x18, 0xDA, 0xF3, 0xDE, 0xD8, 0x83, 0xA5,
    0x94, 0x01, 0xD9, 0xA3, 0x02, 0xF1, 0xA2, 0xC3, 0xC5, 0xC7, 0xD8, 0xF1, 0x84, 0x92, 0xA2, 0x4D,
    0xDA, 0x2A, 0xD8, 0x48, 0x69, 0xD9, 0x2A, 0xD8, 0x68, 0x55, 0xDA, 0x32, 0xD8, 0x50, 0x71, 0xD9,
    0x32, 0xD8, 0x70, 0x5D, 0xDA, 0x3A, 0xD8, 0x58, 0x79, 0xD9, 0x3A, 0xD8, 0x78, 0x93, 0xA3, 0x4D,
    0xDA, 0x2A, 0xD8, 0x48, 0x69, 0xD9, 0x2A, 0xD8, 0x68, 0x55, 0xDA, 0x32, 0xD8, 0x50, 0x71, 0xD9,
    0x32, 0xD8, 0x70, 0x5D, 0xDA, 0x3A, 0xD8, 0x58, 0x79, 0xD9, 0x3A, 0xD8, 0x78, 0xA8, 0x8A, 0x9A,
    0xF0, 0x28, 0x50, 0x78, 0x9E, 0xF3, 0x88, 0x18, 0xF1, 0x9F, 0x1D, 0x98, 0xA8, 0xD9, 0x08, 0xD8,
    0xC8, 0x9F, 0x12, 0x9E, 0xF3, 0x15, 0xA8, 0xDA, 0x12, 0x10, 0xD8, 0xF1, 0xAF, 0xC8, 0x97, 0x87,

    // bank 5, 256 bytes
    0x34, 0xB5, 0xB9, 0x94, 0xA4, 0x21, 0xF3, 0xD9, 0x22, 0xD8, 0xF2, 0x2D, 0xF3, 0xD9, 0x2A, 0xD8,
    0xF2, 0x35, 0xF3, 0xD9, 0x32, 0xD8, 0x81, 0xA4, 0x60, 0x60, 0x61, 0xD9, 0x61, 0xD8, 0x6C, 0x68,
    0x69, 0xD9, 0x69, 0xD8, 0x74, 0x70, 0x71, 0xD9, 0x71, 0xD8, 0xB1, 0xA3, 0x84, 0x19, 0x3D, 0x5D,
    0xA3, 0x83, 0x1A, 0x3E, 0x5E, 0x93, 0x10, 0x30, 0x81, 0x10, 0x11, 0xB8, 0xB0, 0xAF, 0x8F, 0x94,
    0xF2, 0xDA, 0x3E, 0xD8, 0xB4, 0x9A, 0xA8, 0x87, 0x29, 0xDA, 0xF8, 0xD8, 0x87, 0x9A, 0x35, 0xDA,
    0xF8, 0xD8, 0x87, 0x9A, 0x3D, 0xDA, 0xF8, 0xD8, 0xB1, 0xB9, 0xA4, 0x98, 0x85, 0x02, 0x2E, 0x56,
    0xA5, 0x81, 0x00, 0x0C, 0x14, 0xA3, 0x97, 0xB0, 0x8A, 0xF1, 0x2D, 0xD9, 0x28, 0xD8, 0x4D, 0xD9,
    0x48, 0xD8, 0x6D, 0xD9, 0x68, 0xD8, 0xB1, 0x84, 0x0D, 0xDA, 0x0E, 0xD8, 0xA3, 0x29, 0x83, 0xDA,
    0x2C, 0x0E, 0xD8, 0xA3, 0x84, 0x49, 0x83, 0xDA, 0x2C, 0x4C, 0x0E, 0xD8, 0xB8, 0xB0, 0xA8, 0x8A,
    0x9A, 0xF5, 0x20, 0xAA, 0xDA, 0xDF, 0xD8, 0xA8, 0x40, 0xAA, 0xD0, 0xDA, 0xDE, 0xD8, 0xA8, 0x60,
    0xAA, 0xDA, 0xD0, 0xDF, 0xD8, 0xF1, 0x97, 0x86, 0xA8, 0x31, 0x9B, 0x06, 0x99, 0x07, 0xAB, 0x97,
    0x28, 0x88, 0x9B, 0xF0, 0x0C, 0x20, 0x14, 0x40, 0xB8, 0xB0, 0xB4, 0xA8, 0x8C, 0x9C, 0xF0, 0x04,
    0x28, 0x51, 0x79, 0x1D, 0x30, 0x14, 0x38, 0xB2, 0x82, 0xAB, 0xD0, 0x98, 0x2C, 0x50, 0x50, 0x78,
    0x78, 0x9B, 0xF1, 0x1A, 0xB0, 0xF0, 0x8A, 0x9C, 0xA8, 0x29, 0x51, 0x79, 0x8B, 0x29, 0x51, 0x79,
    0x8A, 0x24, 0x70, 0x59, 0x8B, 0x20, 0x58, 0x71, 0x8A, 0x44, 0x69, 0x38, 0x8B, 0x39, 0x40, 0x68,
    0x8A, 0x64, 0x48, 0x31, 0x8B, 0x30, 0x49, 0x60, 0xA5, 0x88, 0x20, 0x09, 0x71, 0x58, 0x44, 0x68,

    // bank 6, 256 bytes
    0x11, 0x39, 0x64, 0x49, 0x30, 0x19, 0xF1, 0xAC, 0x00, 0x2C, 0x54, 0x7C, 0xF0, 0x8C, 0xA8, 0x04,
    0x28, 0x50, 0x78, 0xF1, 0x88, 0x97, 0x26, 0xA8, 0x59, 0x98, 0xAC, 0x8C, 0x02, 0x26, 0x46, 0x66,
    0xF0, 0x89, 0x9C, 0xA8, 0x29, 0x51, 0x79, 0x24, 0x70, 0x59, 0x44, 0x69, 0x38, 0x64, 0x48, 0x31,
    0xA9, 0x88, 0x09, 0x20, 0x59, 0x70, 0xAB, 0x11, 0x38, 0x40, 0x69, 0xA8, 0x19, 0x31, 0x48, 0x60,
    0x8C, 0xA8, 0x3C, 0x41, 0x5C, 0x20, 0x7C, 0x00, 0xF1, 0x87, 0x98, 0x19, 0x86, 0xA8, 0x6E, 0x76,
    0x7E, 0xA9, 0x99, 0x88, 0x2D, 0x55, 0x7D, 0x9E, 0xB9, 0xA3, 0x8A, 0x22, 0x8A, 0x6E, 0x8A, 0x56,
    0x8A, 0x5E, 0x9F, 0xB1, 0x83, 0x06, 0x26, 0x46, 0x66, 0x0E, 0x2E, 0x4E, 0x6E, 0x9D, 0xB8, 0xAD,
    0x00, 0x2C, 0x54, 0x7C, 0xF2, 0xB1, 0x8C, 0xB4, 0x99, 0xB9, 0xA3, 0x2D, 0x55, 0x7D, 0x81, 0x91,
    0xAC, 0x38, 0xAD, 0x3A, 0xB5, 0x83, 0x91, 0xAC, 0x2D, 0xD9, 0x28, 0xD8, 0x4D, 0xD9, 0x48, 0xD8,
    0x6D, 0xD9, 0x68, 0xD8, 0x8C, 0x9D, 0xAE, 0x29, 0xD9, 0x04, 0xAE, 0xD8, 0x51, 0xD9, 0x04, 0xAE,
    0xD8, 0x79, 0xD9, 0x04, 0xD8, 0x81, 0xF3, 0x9D, 0xAD, 0x00, 0x8D, 0xAE, 0x19, 0x81, 0xAD, 0xD9,
    0x01, 0xD8, 0xF2, 0xAE, 0xDA, 0x26, 0xD8, 0x8E, 0x91, 0x29, 0x83, 0xA7, 0xD9, 0xAD, 0xAD, 0xAD,
    0xAD, 0xF3, 0x2A, 0xD8, 0xD8, 0xF1, 0xB0, 0xAC, 0x89, 0x91, 0x3E, 0x5E, 0x76, 0xF3, 0xAC, 0x2E,
    0x2E, 0xF1, 0xB1, 0x8C, 0x5A, 0x9C, 0xAC, 0x2C, 0x28, 0x28, 0x28, 0x9C, 0xAC, 0x30, 0x18, 0xA8,
    0x98, 0x81, 0x28, 0x34, 0x3C, 0x97, 0x24, 0xA7, 0x28, 0x34, 0x3C, 0x9C, 0x24, 0xF2, 0xB0, 0x89,
    0xAC, 0x91, 0x2C, 0x4C, 0x6C, 0x8A, 0x9B, 0x2D, 0xD9, 0xD8, 0xD8, 0x51, 0xD9, 0xD8, 0xD8, 0x79,

    // bank 7, 138 bytes (remainder)
    0xD9, 0xD8, 0xD8, 0xF1, 0x9E, 0x88, 0xA3, 0x31, 0xDA, 0xD8, 0xD8, 0x91, 0x2D, 0xD9, 0x28, 0xD8,
    0x4D, 0xD9, 0x48, 0xD8, 0x6D, 0xD9, 0x68, 0xD8, 0xB1, 0x83, 0x93, 0x35, 0x3D, 0x80, 0x25, 0xDA,
    0xD8, 0xD8, 0x85, 0x69, 0xDA, 0xD8, 0xD8, 0xB4, 0x93, 0x81, 0xA3, 0x28, 0x34, 0x3C, 0xF3, 0xAB,
    0x8B, 0xF8, 0xA3, 0x91, 0xB6, 0x09, 0xB4, 0xD9, 0xAB, 0xDE, 0xFA, 0xB0, 0x87, 0x9C, 0xB9, 0xA3,
    0xDD, 0xF1, 0xA3, 0xA3, 0xA3, 0xA3, 0x95, 0xF1, 0xA3, 0xA3, 0xA3, 0x9D, 0xF1, 0xA3, 0xA3, 0xA3,
    0xA3, 0xF2, 0xA3, 0xB4, 0x90, 0x80, 0xF2, 0xA3, 0xA3, 0xA3, 0xA3, 0xA3, 0xA3, 0xA3, 0xA3, 0xA3,
    0xA3, 0xB2, 0xA3, 0xA3, 0xA3, 0xA3, 0xA3, 0xA3, 0xB0, 0x87, 0xB5, 0x99, 0xF1, 0xA3, 0xA3, 0xA3,
    0x98, 0xF1, 0xA3, 0xA3, 0xA3, 0xA3, 0x97, 0xA3, 0xA3, 0xA3, 0xA3, 0xF3, 0x9B, 0xA3, 0xA3, 0xDC,
    0xB9, 0xA7, 0xF1, 0x26, 0x26, 0x26, 0xD8, 0xD8, 0xFF
]);*/
function getDMPMemory() {
  //btoa(E.toString(require("heatshrink").compress(DMP_MEMORY)))
  return new Uint8Array(require("heatshrink").decompress(atob("/YCBn0AhcAm0AgMAgUAgYQCssAqn/94GB/WACoMSwQVEABsoAQP//9FwIDB/VyCAsD9AECE4MBv4SB/2AA4MbF50+gcwoAGCgXK8cJnxTBgEgCwwTDsADCoP/BocLlQDBi1VAYMhwX9w8mqH9E4UAj4DCgoIDLohACNQY3FAAMEt4PBssyA4Ne4APFZ5WMt9d/tdhHZgF8uc7gFsiXMEgMTzoDB6HWAYMIHYUB+n/82AvLSFCYIDBk8Qf4RTGABBtDaQoHE/U2/+8mGORYP7+H/7Nb5H/6Ga3wTBiGp//0j2ygHO3f3F40ET4UCK4UM//CWYUBAYXPAYJXGJ40GAgcUVxwAkgc/tG2vM1lG841+6NsLIRXG2VqEps/+AECmBNhktNgEvuFtA4MF1ytBgXQCQllgFU//vfxVEA4cMXRIfBAANUAQIjJABLjGB7BEGgTsojYpoNYovqACfY7m60Xx72y3G01GByP3pWQv+RtXz/Pb1H52G60GA+XOwPz4Xx4Py4fz5mi2WA+PG7GA3Wn74AB+Wn4fL4u2+GH0WUklIuE8ytAtE0rGbvBDBweSltVvvY2O03Gh6GRHQNw+dw+V8wGo+MB2GYw/ZofYw3JxG60Pyh24y5GB1JCC1RGD1XF5vH1MM5Msy4ACCoOJk1Gs2w2m6wGs73y5Xx2WMgWp22YgGJh0Wj241O0zMsql82GK1GWm1Wu3x3Ov2mwwfA3Goy8R2OPzAMB+EkhFEiFkjHx0cpPYOvwe1yYQBgEoqANBw2fsOm7Xe7/Z/QJBy3bmOm7P47+602P4XF45XB4O40R7C0YDC7HY+JGB2WG2mYhs1ru41WY2GHls1nuy2261+My0Zx+f055C2maCwOHPQW50ZJBGIOxaYPE5vJGQKOCwYxCxIVBdwRwB0YoC1IkC3CWB+OXweoiOE0sJzGjwfw7SXFMQOlTAWlwuVgUal06q1aoFI/Pz0aMB+GYwYeFy+C1HxiINB0QNF7Xz73YwelykB7OjgXx0XDVgI8BwmS0VN7Uq7FItPZAgNoqvamXYqFx7IEBuFd7U67FYvPZAgN4PwIfd1GKzXwlFQvGe+eIjHxz8dzGo7MI7HIz8SBwMV1HaiUQL4Ov5GXw802u5ymkkPz7Mi7HyloFBI4PymoFBIYOB0lgsFh7Nh7FstBbBtPYulwK4Nx7Gx0eEjM9rrcBjU+r2TiEwwMQiO42Gvx+U+Xan3Y2ma1GHlPa/HYw+amoFEnoFC2O50mYwsCl1W0uBgEMimjy+wxXxlvZlHYpvZpHYtvZtAdBwkN7UO7GjlOD7UsAwWEpIHCpgIBKAKwC+sg1Xa7/Y1FA1XQ7XeAwNgBgPQBoPxy+G1ExzcGzMH1eXlGIzfwhkgilAFYO01GMznwgkoqN5jswik42WC1fQzEsqDrBvGb+Ma2HwxWc1EpDAOLAYWKklwrOLkFYuOKolpnGLnNAtGKslImOLmFJsGlxEghNxrFEtERnNkpMwjPx1kAllUvnwxmoJ4JCB+OIy8m1FZzGsxkCk1Gs3wxJKEIoRACHYWpxEJkFZuGriM4oFp1EZmNIsAyBnlBrkgvkA+OHzEZUgNuu1+1OZxEtqt9z250eKkWKt2Kq2Kr2f2ODgxICh0up1uzu41pnD+Wxxm0zIgBEwWByOsnGtnW1wYGBlvZlHYpvZpHYtvZtHYxmd10p7ME13YqIEDvIEB7GB+edHAON10ZwOt7MB7Hy13ak3Yx2RlOD0/Z1oAC+cq7HY+Ow1mJyM+r12+esl0u+JcBrWc1kslAABAoMwjGozGBlE0nmXkmnAoWckny2GJ1mRllMtmKzZuBGoJeBAYJdBHoWexGjmPaA4ORQZa0Byc1nuAkoWCwtpAgW0yeB0ZCC+erxf40eR20J2nZ1fe/Www+cYgPd+OjAAWVAoedBQny0e0yGAAgIAI2QGFFgO1zIfDzAkEy4ED+ebAYPc3On+MmAAJgB/4")));
}



/*var DMP_CONFIG = new Uint8Array([
//  BANK    OFFSET  LENGTH  [DATA]
    0x03,   0x7B,   0x03,   0x4C, 0xCD, 0x6C,         // FCFG_1 inv_set_gyro_calibration
    0x03,   0xAB,   0x03,   0x36, 0x56, 0x76,         // FCFG_3 inv_set_gyro_calibration
    0x00,   0x68,   0x04,   0x02, 0xCB, 0x47, 0xA2,   // D_0_104 inv_set_gyro_calibration
    0x02,   0x18,   0x04,   0x00, 0x05, 0x8B, 0xC1,   // D_0_24 inv_set_gyro_calibration
    0x01,   0x0C,   0x04,   0x00, 0x00, 0x00, 0x00,   // D_1_152 inv_set_accel_calibration
    0x03,   0x7F,   0x06,   0x0C, 0xC9, 0x2C, 0x97, 0x97, 0x97, // FCFG_2 inv_set_accel_calibration
    0x03,   0x89,   0x03,   0x26, 0x46, 0x66,         // FCFG_7 inv_set_accel_calibration
    0x00,   0x6C,   0x02,   0x20, 0x00,               // D_0_108 inv_set_accel_calibration
    0x02,   0x40,   0x04,   0x00, 0x00, 0x00, 0x00,   // CPASS_MTX_00 inv_set_compass_calibration
    0x02,   0x44,   0x04,   0x00, 0x00, 0x00, 0x00,   // CPASS_MTX_01
    0x02,   0x48,   0x04,   0x00, 0x00, 0x00, 0x00,   // CPASS_MTX_02
    0x02,   0x4C,   0x04,   0x00, 0x00, 0x00, 0x00,   // CPASS_MTX_10
    0x02,   0x50,   0x04,   0x00, 0x00, 0x00, 0x00,   // CPASS_MTX_11
    0x02,   0x54,   0x04,   0x00, 0x00, 0x00, 0x00,   // CPASS_MTX_12
    0x02,   0x58,   0x04,   0x00, 0x00, 0x00, 0x00,   // CPASS_MTX_20
    0x02,   0x5C,   0x04,   0x00, 0x00, 0x00, 0x00,   // CPASS_MTX_21
    0x02,   0xBC,   0x04,   0x00, 0x00, 0x00, 0x00,   // CPASS_MTX_22
    0x01,   0xEC,   0x04,   0x00, 0x00, 0x40, 0x00,   // D_1_236 inv_apply_endian_accel
    0x03,   0x7F,   0x06,   0x0C, 0xC9, 0x2C, 0x97, 0x97, 0x97, // FCFG_2 inv_set_mpu_sensors
    0x04,   0x02,   0x03,   0x0D, 0x35, 0x5D,         // CFG_MOTION_BIAS inv_turn_on_bias_from_no_motion
    0x04,   0x09,   0x04,   0x87, 0x2D, 0x35, 0x3D,   // FCFG_5 inv_set_bias_update
    0x00,   0xA3,   0x01,   0x00,                     // D_0_163 inv_set_dead_zone
                 // SPECIAL 0x01 = enable interrupts
    0x00,   0x00,   0x00,   0x01, // SET INT_ENABLE at i=22, SPECIAL INSTRUCTION
    0x07,   0x86,   0x01,   0xFE,                     // CFG_6 inv_set_fifo_interupt
    0x07,   0x41,   0x05,   0xF1, 0x20, 0x28, 0x30, 0x38, // CFG_8 inv_send_quaternion
    0x07,   0x7E,   0x01,   0x30,                     // CFG_16 inv_set_footer
    0x07,   0x46,   0x01,   0x9A,                     // CFG_GYRO_SOURCE inv_send_gyro
    0x07,   0x47,   0x04,   0xF1, 0x28, 0x30, 0x38,   // CFG_9 inv_send_gyro -> inv_construct3_fifo
    0x07,   0x6C,   0x04,   0xF1, 0x28, 0x30, 0x38,   // CFG_12 inv_send_accel -> inv_construct3_fifo
    0x02,   0x16,   0x02,   0x00, 0x00                // D_0_22 inv_set_fifo_rate. The last data Byte is the FifoRate and will be replaced later
]);*/
function getDMPConfig() {
  //btoa(E.toString(require("heatshrink").compress(DMP_CONFIG)))
  return new Uint8Array(require("heatshrink").decompress(atob("gd7gdM5tsgergc2q12gFogkC5dH0UCjEEgEFxfBgMMAwIgDv8GhnJlmXAAMDxMDk1Gs0AtkCkEAgVADQkCogGFpAGFpgGFqAGFqgGFrAGFrgGF3gGEgPsAwVALJJ1BgcNmtdgkJgmHls1nsA0cBEYkHw0B/0HoMF+MglEwnEHv0BmEHo0BzUHo8E+IODtgGEgUWgQnBA")));
}

DMP.prototype.writeDMPConfigurationSet = function(data) {
  var dataSize = data.length
  data[dataSize-1] = this.fifoRate;


  // config set data is a long string of blocks with the following structure:
  // [bank] [offset] [length] [byte[0], byte[1], ..., byte[length]]
  var bank = 0;
  var offset = 0;
  var length = 0;
  var special = 0;

  for(var i = 0; i < dataSize;) {
    bank = data[i++];
    offset = data[i++];
    length = data[i++];

    // write data or perform special action
    if (length > 0) {
      // regular block of data to write
      if(! this.mpu.writeMemoryBlock(data.slice(i, i + length), bank, offset)) {
        console.log("Can't write to MSP6050 memory block");
        return false;
      }

      i += length;
    } else {
      // special instruction
      // NOTE: this kind of behavior (what and when to do certain things) is totally undocumented.
      special = data[i++];

      if (special == 0x01) {
        // enable DMP-related interrupts
        this.mpu.writeBytes(R.INT_ENABLE, 0x32);
      } else {
        console.log("Unknowns special command: " + special);
        return false;
      }
    }

  }

  return true;
}


DMP.prototype.setIntEnabled = function(enabled) {
  this.mpu.writeBytes(R.INT_ENABLE, enabled);
}

DMP.prototype.setSampleRate = function(rate) {
  this.mpu.writeBytes(R.SMPLRT_DIV, rate);
}

DMP.prototype.setExternalFrameSync = function(sync) {
  this.mpu.writeBits(R.CONFIG, C.EXT_SYNC_SET_BIT, C.EXT_SYNC_SET_LENGTH, sync);
}

DMP.prototype.setDLPFMode = function(mode) {
  this.mpu.writeBits(R.CONFIG, C.DLPF_CFG_BIT, C.DLPF_CFG_LENGTH, mode);
}

DMP.prototype.setDMPConfig1 = function(config) {
  this.mpu.writeBytes(R.DMP_CFG_1, config);
}

DMP.prototype.setDMPConfig2 = function(config) {
  this.mpu.writeBytes(R.DMP_CFG_2, config);
}

DMP.prototype.setFIFOEnabled = function(enabled) {
  this.mpu.writeBit(R.USER_CTRL, C.USERCTRL_FIFO_EN_BIT, enabled);
}

/**
 * This bit resets the FIFO buffer when set to 1 while FIFO_EN equals 0. This
 * bit automatically clears to 0 after the reset has been triggered.
 */
DMP.prototype.resetFIFO = function() {
    this.mpu.writeBit(R.USER_CTRL, C.USERCTRL_FIFO_RESET_BIT, true);
}

/**
 * This value indicates the number of bytes stored in the FIFO buffer. This
 * number is in turn the number of bytes that can be read from the FIFO buffer
 * and it is directly proportional to the number of samples available given the
 * set of sensor data bound to be stored in the FIFO (register 35 and 36).
 */
DMP.prototype.getFIFOCount = function() {
    var buffer = this.mpu.readBytes(R.FIFO_COUNT_H, 2);
    return (buffer[0] << 8) | buffer[1];
}

/**
 * This register is used to read and write data from the FIFO buffer. Data is
 * written to the FIFO in order of register number (from lowest to highest). If
 * all the FIFO enable flags (see below) are enabled and all External Sensor
 * Data registers (Registers 73 to 96) are associated with a Slave device, the
 * contents of registers 59 through 96 will be written in order at the Sample
 * Rate.
 *
 * The contents of the sensor data registers (Registers 59 to 96) are written
 * into the FIFO buffer when their corresponding FIFO enable flags are set to 1
 * in FIFO_EN (Register 35). An additional flag for the sensor data registers
 * associated with I2C Slave 3 can be found in I2C_MST_CTRL (Register 36).
 *
 * If the FIFO buffer has overflowed, the status bit FIFO_OFLOW_INT is
 * automatically set to 1. This bit is located in INT_STATUS (Register 58).
 * When the FIFO buffer has overflowed, the oldest data will be lost and new
 * data will be written to the FIFO.
 *
 * If the FIFO buffer is empty, reading this register will return the last byte
 * that was previously read from the FIFO until new data is available. The user
 * should check FIFO_COUNT to ensure that the FIFO buffer is not read when
 * empty.
 */
DMP.prototype.getFIFOBytes = function(length) {
  if(length < 1) return new Uint8Array([]);
  return this.mpu.readBytes( R.FIFO_R_W, length);
}


/** Set motion detection event acceleration threshold.
 * @param threshold New motion detection acceleration threshold value (LSB = 2mg)
 */
DMP.prototype.setMotionDetectionThreshold = function(threshold) {
    this.mpu.writeBytes(R.MOT_THR, threshold);
}

/** Set zero motion detection event acceleration threshold.
 * @param threshold New zero motion detection acceleration threshold value (LSB = 2mg)
 */
DMP.prototype.setZeroMotionDetectionThreshold = function(threshold) {
    this.mpu.writeBytes(R.ZRMOT_THR, threshold);
}

/** Set motion detection event duration threshold.
 * @param duration New motion detection duration threshold value (LSB = 1ms)
 */
DMP.prototype.setMotionDetectionDuration = function(duration) {
    this.mpu.writeBytes(R.MOT_DUR, duration);
}

/** Set zero motion detection event duration threshold.
 * @param duration New zero motion detection duration threshold value (LSB = 1ms)
 */
DMP.prototype.setZeroMotionDetectionDuration = function(duration) {
    this.mpu.writeBytes(R.ZRMOT_DUR, duration);
}


DMP.prototype.setDMPEnabled = function(enabled) {
    this.mpu.writeBit(R.USER_CTRL, C.USERCTRL_DMP_EN_BIT, enabled);
}

DMP.prototype.resetDMP = function() {
    this.mpu.writeBit(R.USER_CTRL, C.USERCTRL_DMP_RESET_BIT, true);
}

/** Get full set of interrupt status bits.
 * These bits clear to 0 after the register has been read. Very useful
 * for getting multiple INT statuses, since each single bit read clears
 * all of them because it has to read the whole byte.
 */
DMP.prototype.getIntStatus = function() {
    return this.mpu.readBytes( R.INT_STATUS, 1)[0];
}

DMP.prototype.initialize = function() {
  console.log("Resetting MPU6050...");
  this.mpu.reset();
  //this.dmpInitialize1();
  setTimeout(initialize1, 30, this);
}

var initialize1 = function(dmp) {
  dmp.mpu.setSleepEnabled(false);

  dmp.mpu.setMemoryBank(0, false, false);

  // Reading OTP bank valid flag...
  console.log("OTP bank is " + (dmp.mpu.getOTPBankValid() ? "valid!" : "INvalid!"));

  // get X/Y/Z gyro offsets TC values...
  var xgOffsetTC = dmp.mpu.getXGyroOffsetTC();
  var ygOffsetTC = dmp.mpu.getYGyroOffsetTC();
  var zgOffsetTC = dmp.mpu.getZGyroOffsetTC();

  // setup weird slave stuff (?)
  dmp.mpu.setSlaveAddress(0, 0x7F);
  dmp.mpu.setI2CMasterModeEnabled(false);
  dmp.mpu.setSlaveAddress(0, 0x68);
  dmp.mpu.resetI2CMaster();

  setTimeout(initialize2, 20, dmp, xgOffsetTC, ygOffsetTC, zgOffsetTC);
}


var initialize2 = function(dmp, xgOffsetTC, ygOffsetTC, zgOffsetTC) {
  // load DMP code into memory banks
  if (dmp.mpu.writeMemoryBlock(getDMPMemory(), 0, 0)) {
    console.log("Success! DMP code written and verified.");
    if (dmp.writeDMPConfigurationSet(getDMPConfig())) {
      console.log("Success! DMP configuration written and verified.");

      // Setting clock source to Z Gyro...
      dmp.mpu.setClockSource(C.CLOCK_PLL_ZGYRO);
      // Setting DMP and FIFO_OFLOW interrupts enabled...
      dmp.setIntEnabled(0x12);
      // Setting sample rate to 200Hz...
      dmp.setSampleRate(4); // 1khz / (1 + 4) = 200 Hz
      // Setting external frame sync to TEMP_OUT_L[0]...
      dmp.setExternalFrameSync(C.EXT_SYNC_TEMP_OUT_L);
      // Setting DLPF bandwidth to 42Hz...
      dmp.setDLPFMode(C.DLPF_BW_42);
      // Setting gyro sensitivity to +/- 2000 deg/sec
      dmp.mpu.setFullScaleGyroRange(C.GYRO_FS_2000);
      // Setting DMP configuration bytes (function unknown)...
      dmp.setDMPConfig1(0x03);
      dmp.setDMPConfig2(0x00);
      // Clearing OTP Bank flag...
      dmp.mpu.setOTPBankValid(false);
      //Setting X/Y/Z gyro offset TCs to previous values...
      dmp.mpu.setXGyroOffsetTC(xgOffsetTC);
      dmp.mpu.setYGyroOffsetTC(ygOffsetTC);
      dmp.mpu.setZGyroOffsetTC(zgOffsetTC);

      var DMP_UPDATES = [
    //   BANK  ADDRESS    DATA...
        [0x01,   0xB2,   [0xFF, 0xFF]],
        [0x01,   0x90,   [0x09, 0x23, 0xA1, 0x35]],
        [0x01,   0x6A,   [0x06, 0x00]],
        [0x01,   0x60,   [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]],
        [0x00,   0x60,   [0x40, 0x00, 0x00, 0x00]],
        [0x01,   0x62,   [0x00, 0x00]],
        [0x00,   0x60,   [0x00, 0x40, 0x00, 0x00]]
    ];

      // Writing final memory update 1/7 (function unknown)...
      dmp.mpu.writeMemoryBlock(DMP_UPDATES[0][2], DMP_UPDATES[0][0], DMP_UPDATES[0][1]);
      // Writing final memory update 2/7 (function unknown)...
      dmp.mpu.writeMemoryBlock(DMP_UPDATES[1][2], DMP_UPDATES[1][0], DMP_UPDATES[1][1]);

      dmp.resetFIFO();
      dmp.getFIFOBytes(dmp.getFIFOCount());

      dmp.setMotionDetectionThreshold(2);
      dmp.setZeroMotionDetectionThreshold(156);
      dmp.setMotionDetectionDuration(80);
      dmp.setZeroMotionDetectionDuration(0);

      dmp.resetFIFO();
      dmp.setFIFOEnabled(true);
      dmp.setDMPEnabled(true);
      dmp.resetDMP();

      // Writing final memory update 3/7 (function unknown)...
      dmp.mpu.writeMemoryBlock(DMP_UPDATES[2][2], DMP_UPDATES[2][0], DMP_UPDATES[2][1]);
      // Writing final memory update 4/7 (function unknown)...
      dmp.mpu.writeMemoryBlock(DMP_UPDATES[3][2], DMP_UPDATES[3][0], DMP_UPDATES[3][1]);
      // Writing final memory update 5/7 (function unknown)...
      dmp.mpu.writeMemoryBlock(DMP_UPDATES[4][2], DMP_UPDATES[4][0], DMP_UPDATES[4][1]);

      // Waiting for FIFO count > 2...
      var fifoCount = 0;
      while ((fifoCount = dmp.getFIFOCount()) < 3);
      console.log("FIFO count: " + fifoCount + " Data: " + dmp.getFIFOBytes(fifoCount));
      console.log("IntStatus: " + dmp.getIntStatus());

      // Reading final memory update 6/7 (function unknown)...
      dmp.mpu.readMemoryBlock(2, DMP_UPDATES[5][0], DMP_UPDATES[5][1]);

      while ((fifoCount = dmp.getFIFOCount()) < 3);
      console.log("FIFO count: " + fifoCount + " Data: " + dmp.getFIFOBytes(fifoCount));
      console.log("IntStatus: " + dmp.getIntStatus());

      // Writing final memory update 7/7 (function unknown)...
      dmp.mpu.writeMemoryBlock(DMP_UPDATES[6][2], DMP_UPDATES[6][0], DMP_UPDATES[6][1]);

      dmp.resetFIFO();
      console.log("DMP is good to go! IntStatus: " + dmp.getIntStatus());
    } else {
      return 2; // configuration block loading failed
    }

    return 0; // success
  } else {
    return 1; // main binary block loading failed
  }
}
