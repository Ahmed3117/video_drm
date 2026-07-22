const fs = require('fs');
const path = require('path');
const { encryptFile, parseHeader, createDecryptedRangeStream, verifyFilePassword } = require('./encryptor');

const TEST_FILE = path.join(__dirname, 'mock_video.bin');
const ENC_FILE = path.join(__dirname, 'mock_video.envideo');
const PASSWORD = 'super-secret-drm-key';
const TITLE = 'Test Mock Video';

function generateMockData(size) {
  const buffer = Buffer.alloc(size);
  for (let i = 0; i < size; i++) {
    buffer[i] = i % 256; // Fill with sequential bytes
  }
  return buffer;
}

async function runTest() {
  console.log('--- STARTING CRYPTOGRAPHY VALIDATION ---');
  
  // 1. Create a 10KB mock binary file
  const originalSize = 10 * 1024; // 10,240 bytes
  const originalData = generateMockData(originalSize);
  fs.writeFileSync(TEST_FILE, originalData);
  console.log(`[1] Created mock file of size ${originalSize} bytes.`);
  
  try {
    // 2. Encrypt the file
    console.log(`[2] Encrypting mock file...`);
    await encryptFile(TEST_FILE, ENC_FILE, PASSWORD, { title: TITLE });
    console.log(`    Encrypted successfully! Output saved to: ${ENC_FILE}`);
    
    // 3. Verify Password validation
    console.log(`[3] Validating password verification...`);
    const isCorrectValid = await verifyFilePassword(ENC_FILE, PASSWORD);
    const isIncorrectValid = await verifyFilePassword(ENC_FILE, 'wrong-password');
    
    console.log(`    Correct password validation: ${isCorrectValid ? 'PASS' : 'FAIL'}`);
    console.log(`    Incorrect password validation: ${!isIncorrectValid ? 'PASS' : 'FAIL'}`);
    
    if (!isCorrectValid || isIncorrectValid) {
      throw new Error('Password verification failed.');
    }

    // 4. Parse Header
    console.log(`[4] Parsing encrypted file header...`);
    const headerInfo = await parseHeader(ENC_FILE);
    console.log(`    Header size: ${headerInfo.headerSize} bytes`);
    console.log(`    Metadata Title: "${headerInfo.metadata.title}"`);
    console.log(`    Metadata Original Size: ${headerInfo.metadata.originalSize}`);
    
    if (headerInfo.metadata.title !== TITLE || headerInfo.metadata.originalSize !== originalSize) {
      throw new Error('Header metadata parsing mismatch.');
    }

    // 5. Test Range Decryption (arbitrary offset and length)
    // We will request 3 different ranges, including block-aligned and non-block-aligned offsets.
    const rangesToTest = [
      { start: 0, end: 15 },       // First block
      { start: 100, end: 199 },    // Cross-block, unaligned
      { start: 2048, end: 4095 },  // Aligned multi-block
      { start: 5013, end: 5015 },  // Small range, unaligned
      { start: originalSize - 20, end: originalSize - 1 } // Tail end
    ];
    
    console.log(`[5] Testing range decryption streams (Random Access Seek)...`);
    
    for (const testRange of rangesToTest) {
      const { start, end } = testRange;
      const expectedSize = end - start + 1;
      
      console.log(`    Scrubbing to byte range: [${start} - ${end}] (Expected decrypted size: ${expectedSize} bytes)`);
      
      const { stream, streamSize, totalDecryptedSize } = await createDecryptedRangeStream(
        ENC_FILE,
        PASSWORD,
        start,
        end
      );
      
      if (totalDecryptedSize !== originalSize) {
        throw new Error(`Total size mismatch. Expected ${originalSize}, got ${totalDecryptedSize}`);
      }
      
      if (streamSize !== expectedSize) {
        throw new Error(`Stream size mismatch. Expected ${expectedSize}, got ${streamSize}`);
      }
      
      // Read all bytes from the decrypted stream
      const decryptedChunks = [];
      for await (const chunk of stream) {
        decryptedChunks.push(chunk);
      }
      const decryptedBuffer = Buffer.concat(decryptedChunks);
      
      if (decryptedBuffer.length !== expectedSize) {
        throw new Error(`Decrypted buffer length mismatch. Expected ${expectedSize}, got ${decryptedBuffer.length}`);
      }
      
      // Compare bytes with original slice
      const originalSlice = originalData.subarray(start, end + 1);
      const isMatch = decryptedBuffer.equals(originalSlice);
      
      if (isMatch) {
        console.log(`    -> SUCCESS: Decrypted bytes match original exactly!`);
      } else {
        console.error(`    -> FAILURE: Mismatched decrypted bytes:`);
        console.error(`       Expected:`, originalSlice.subarray(0, 16));
        console.error(`       Got:     `, decryptedBuffer.subarray(0, 16));
        throw new Error(`Byte mismatch in decrypted stream for range ${start}-${end}`);
      }
    }
    
    console.log('\n--- ALL CRYPTOGRAPHY TESTS PASSED SUCCESSFULLY! ---');
  } catch (err) {
    console.error('\n--- TEST FAILED WITH ERROR: ---', err);
    process.exit(1);
  } finally {
    // Cleanup files
    try { fs.unlinkSync(TEST_FILE); } catch(e){}
    try { fs.unlinkSync(ENC_FILE); } catch(e){}
  }
}

runTest();
