const crypto = require('node:crypto');
const a = crypto.randomBytes(48).toString('hex');
const b = crypto.randomBytes(48).toString('hex');
console.log(a);
console.log(b);
