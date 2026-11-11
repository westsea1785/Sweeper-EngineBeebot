import crypto from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

// Must be exactly 64 hex characters (32 bytes). You will set this in Railway variables.
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ALGORITHM = 'aes-256-gcm';

export const encryptKey = (privateKey: string): string => {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    
    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    
    // Format: iv:ciphertext:authTag
    return `${iv.toString('hex')}:${encrypted}:${authTag}`;
};

export const decryptKey = (encryptedData: string): string => {
    const [ivHex, encryptedHex, authTagHex] = encryptedData.split(':');
    
    const decipher = crypto.createDecipheriv(
        ALGORITHM, 
        Buffer.from(ENCRYPTION_KEY, 'hex'), 
        Buffer.from(ivHex, 'hex')
    );
    
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
};
