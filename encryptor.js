const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');

const MAGIC_BYTES = 'ENVIDEO'; // 7 bytes
const VERSION = 0x01; // 1 byte
const BLOCK_SIZE = 16;

/**
 * Derives a 32-byte key from a password string.
 * @param {string} password 
 * @returns {Buffer}
 */
function deriveKey(password) {
  return crypto.createHash('sha256').update(password).digest();
}

/**
 * Increments a 16-byte IV buffer as a 128-bit big-endian integer by a given BigInt increment.
 * @param {Buffer} iv 
 * @param {bigint|number} increment 
 * @returns {Buffer}
 */
function incrementIV(iv, increment) {
  const result = Buffer.from(iv);
  let carry = BigInt(increment);
  
  for (let i = 15; i >= 0; i--) {
    if (carry === 0n) break;
    const val = BigInt(result[i]) + carry;
    result[i] = Number(val & 0xffn);
    carry = val >> 8n;
  }
  return result;
}

/**
 * A transform stream that discards the first N bytes.
 */
class SkipBytesStream extends Transform {
  constructor(skipBytes) {
    super();
    this.skipBytes = skipBytes;
  }
  
  _transform(chunk, encoding, callback) {
    if (this.skipBytes > 0) {
      if (chunk.length <= this.skipBytes) {
        this.skipBytes -= chunk.length;
        callback(); // Discard this chunk
      } else {
        const sliced = chunk.subarray(this.skipBytes);
        this.skipBytes = 0;
        callback(null, sliced);
      }
    } else {
      callback(null, chunk);
    }
  }
}

/**
 * Encrypts an MP4 file into the custom .envideo format.
 * @param {string} inputPath 
 * @param {string} outputPath 
 * @param {string} password 
 * @param {object} metadata 
 * @returns {Promise<void>}
 */
function encryptFile(inputPath, outputPath, password, metadata = {}) {
  return new Promise((resolve, reject) => {
    try {
      const key = deriveKey(password);
      const iv = crypto.randomBytes(16);
      
      // Prepare metadata
      const passHash = crypto.createHash('sha256').update(password).digest('hex');
      const metaObj = {
        title: metadata.title || path.basename(inputPath),
        addedAt: new Date().toISOString(),
        originalSize: fs.statSync(inputPath).size,
        passHash,
        ...metadata
      };
      const metaBuffer = Buffer.from(JSON.stringify(metaObj), 'utf8');
      const metaLengthBuffer = Buffer.alloc(4);
      metaLengthBuffer.writeUInt32BE(metaBuffer.length, 0);

      // Create write stream
      const writeStream = fs.createWriteStream(outputPath);
      
      // Write Header
      writeStream.write(Buffer.from(MAGIC_BYTES, 'utf8')); // 7 bytes
      writeStream.write(Buffer.from([VERSION]));           // 1 byte
      writeStream.write(iv);                               // 16 bytes
      writeStream.write(metaLengthBuffer);                 // 4 bytes
      writeStream.write(metaBuffer);                       // N bytes

      // Create cipher
      const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);
      const readStream = fs.createReadStream(inputPath);

      readStream
        .pipe(cipher)
        .pipe(writeStream)
        .on('finish', () => {
          resolve();
        })
        .on('error', (err) => {
          reject(err);
        });
        
      writeStream.on('error', (err) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Parses the header of an encrypted .envideo file.
 * @param {string} filePath 
 * @returns {Promise<{headerSize: number, iv: Buffer, version: number, metadata: object}>}
 */
function parseHeader(filePath) {
  return new Promise((resolve, reject) => {
    const fd = fs.openSync(filePath, 'r');
    try {
      // 1. Read magic bytes and version (8 bytes)
      const magicAndVersion = Buffer.alloc(8);
      fs.readSync(fd, magicAndVersion, 0, 8, 0);
      
      const magic = magicAndVersion.subarray(0, 7).toString('utf8');
      const version = magicAndVersion[7];
      
      if (magic !== MAGIC_BYTES) {
        throw new Error('Invalid file format. Magic bytes do not match.');
      }
      
      // 2. Read IV (16 bytes)
      const iv = Buffer.alloc(16);
      fs.readSync(fd, iv, 0, 16, 8);
      
      // 3. Read metadata length (4 bytes)
      const metaLengthBuf = Buffer.alloc(4);
      fs.readSync(fd, metaLengthBuf, 0, 4, 24);
      const metaLength = metaLengthBuf.readUInt32BE(0);
      
      // 4. Read metadata
      const metaBuf = Buffer.alloc(metaLength);
      fs.readSync(fd, metaBuf, 0, metaLength, 28);
      const metadata = JSON.parse(metaBuf.toString('utf8'));
      
      const headerSize = 28 + metaLength;
      fs.closeSync(fd);
      
      resolve({
        headerSize,
        iv,
        version,
        metadata
      });
    } catch (err) {
      try { fs.closeSync(fd); } catch(e){}
      reject(err);
    }
  });
}

/**
 * Creates a decrypted read stream for a specific range of the file.
 * @param {string} filePath 
 * @param {string} password 
 * @param {number} decryptedStart 
 * @param {number} decryptedEnd 
 * @returns {Promise<{stream: Readable, streamSize: number, totalDecryptedSize: number}>}
 */
async function createDecryptedRangeStream(filePath, password, decryptedStart, decryptedEnd) {
  const { headerSize, iv, metadata } = await parseHeader(filePath);
  const key = deriveKey(password);
  
  const totalDecryptedSize = metadata.originalSize;
  const end = (decryptedEnd === undefined || decryptedEnd === null) ? totalDecryptedSize - 1 : decryptedEnd;
  const start = decryptedStart || 0;

  // Calculate block alignment
  const blockIndex = Math.floor(start / BLOCK_SIZE);
  const alignedStart = blockIndex * BLOCK_SIZE;
  const skipBytes = start - alignedStart;
  
  // Calculate read positions in ciphertext
  const ciphertextStart = headerSize + alignedStart;
  const ciphertextEnd = headerSize + end;
  
  // Adjust IV for this block index
  const newIv = incrementIV(iv, blockIndex);
  
  // Create decipher and stream
  const decipher = crypto.createDecipheriv('aes-256-ctr', key, newIv);
  const fileStream = fs.createReadStream(filePath, {
    start: ciphertextStart,
    end: ciphertextEnd
  });
  
  // Pipe and skip the padding bytes from the block alignment
  let stream = fileStream.pipe(decipher);
  if (skipBytes > 0) {
    stream = stream.pipe(new SkipBytesStream(skipBytes));
  }
  
  const streamSize = end - start + 1;
  
  return {
    stream,
    streamSize,
    totalDecryptedSize
  };
}

async function verifyFilePassword(filePath, password) {
  try {
    const { metadata } = await parseHeader(filePath);
    const passHash = crypto.createHash('sha256').update(password).digest('hex');
    return metadata.passHash === passHash;
  } catch (err) {
    return false;
  }
}

module.exports = {
  encryptFile,
  parseHeader,
  createDecryptedRangeStream,
  verifyFilePassword,
  deriveKey,
  incrementIV
};

// CLI Command handler
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.log('Usage: node encryptor.js <encrypt|decrypt> <input_file> <password> [title]');
    process.exit(1);
  }
  
  const mode = args[0];
  const input = args[1];
  const password = args[2];
  const title = args[3] || path.basename(input);
  
  if (mode === 'encrypt') {
    const output = input.replace(/\.[^/.]+$/, "") + ".envideo";
    console.log(`Encrypting ${input} to ${output}...`);
    encryptFile(input, output, password, { title })
      .then(() => {
        console.log('Encryption successful!');
      })
      .catch((err) => {
        console.error('Encryption failed:', err);
      });
  } else if (mode === 'decrypt') {
    // Simple full file decrypt tool for debugging
    const output = input.replace(/\.envideo$/, "") + "_decrypted.mp4";
    console.log(`Decrypting ${input} to ${output}...`);
    
    parseHeader(input).then(({ headerSize, iv, metadata }) => {
      const key = deriveKey(password);
      const decipher = crypto.createDecipheriv('aes-256-ctr', key, iv);
      const readStream = fs.createReadStream(input, { start: headerSize });
      const writeStream = fs.createWriteStream(output);
      
      readStream.pipe(decipher).pipe(writeStream).on('finish', () => {
        console.log(`Decryption successful! Saved as ${output}`);
      }).on('error', (err) => {
        console.error('Decryption failed:', err);
      });
    }).catch(err => {
      console.error('Failed to parse header:', err);
    });
  } else {
    console.error('Unknown mode. Use "encrypt" or "decrypt".');
  }
}
