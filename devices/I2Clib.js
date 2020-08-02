/* I2Clib Object */
function I2Clib(i2c, addr) {
  this.i2c = i2c;
  this.addr = addr;
}

exports.connect = function (i2c, addr) {
  return new I2Clib(i2c, addr);
};

I2Clib.prototype.readBytes = function(reg, length) {
  this.i2c.writeTo(this.addr, reg);
  return this.i2c.readFrom(this.addr, length);
};

I2Clib.prototype.readWord = function(reg) {
  const d = this.readBytes(this.addr, 2);
  return d[1] | d[0] << 8;
};

I2Clib.prototype.readSigned = function(reg) {
  const d = this.readWord(reg);
  return (d > 32768) ? d - 65536 : d;
};

/** Read a single bit from an 8-bit device register.
 * @param reg Register to read from
 * @param bit Bit position to read (0-7)
 * @return The bit value read.
 */
I2Clib.prototype.readBit = function(reg, bit) {
  var b = this.readBytes(reg, 1)[0];
  b &= (1 << bit);
  return b;
};

/** Read multiple bits from an 8-bit device register.
 * @param reg Register to read from
 * @param bitStart First bit position to read (0-7)
 * @param length Number of bits to read (not more than 8)
 * @return The right-aligned value (i.e. '101' read from any bitStart position will equal 0x05)
 */

// 01101001 read byte
// 76543210 bit numbers
//    xxx   args: bitStart=4, length=3
//    010   masked
//   -> 010 shifted
I2Clib.prototype.readBits = function(reg, bitStart, length) {
  var b = this.readBytes(reg, 1)[0];
  var mask = ((1 << length) - 1) << (bitStart - length + 1);
  b &= mask;
  b >>= (bitStart - length + 1);
  return b;
};


/* Read 6 bytes and return 3 signed integer values */
I2Clib.prototype.readSXYZ = function(reg) {
  this.i2c.writeTo(this.addr, reg);
  var bytes = this.i2c.readFrom(this.addr, 6);
  var x = (bytes[0] << 8) | bytes[1];
  var y = (bytes[2] << 8) | bytes[3];
  var z = (bytes[4] << 8) | bytes[5];
  x = (x>32767) ? x - 65536 : x;
  y = (y>32767) ? y - 65536 : y;
  z = (z>32767) ? z - 65536 : z;
  return [x, y ,z];
};

I2Clib.prototype.writeBytes = function(reg, data) {
  this.i2c.writeTo(this.addr, [reg].concat(data));
};

/* Set a single bit in a register */
I2Clib.prototype.writeBit = function(reg, bit, val) {
  var b = this.readBytes(reg, 1)[0];
  b = (val != 0) ? (b | (1 << bit)) : (b & ~(1 << bit));
  this.writeBytes(reg, b);
};

I2Clib.prototype.writeWord = function(reg, data) {
  this.i2c.writeTo(this.addr, [reg, data >> 8, data]);
};

/* Set more bits in a register */

//      010 value to write
// 76543210 bit numbers
//    xxx   args: bitStart=4, length=3
// 00011100 mask byte
// 10101111 original value (sample)
// 10100011 original & ~mask
// 10101011 masked | value
I2Clib.prototype.writeBits = function(reg, bitStart, length, val) {
  var b = this.readBytes(reg, 1)[0];

  var mask = ((1 << length) - 1) << (bitStart - length + 1);
  val <<= (bitStart - length + 1); // shift data into correct position
  val &= mask; // zero all non-important bits in data
  b &= ~(mask); // zero all important bits in existing byte
  b |= val; // combine data with existing byte

  this.writeBytes(reg, b);
};
