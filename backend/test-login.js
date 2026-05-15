const http = require('http');

const loginData = JSON.stringify({
  correo: 'admin@alfosac.pe',
  contrasena: 'admin'
});

const options = {
  hostname: 'localhost',
  port: 5000,
  path: '/api/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': loginData.length
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      console.log(JSON.stringify(parsed, null, 2));
      if (parsed.token) {
        console.log('\n✓ Login successful. Token:', parsed.token.substring(0, 50) + '...');
      }
    } catch {
      console.log('Response:', data);
    }
  });
});

req.on('error', console.error);
req.write(loginData);
req.end();
