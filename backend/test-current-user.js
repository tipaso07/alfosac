const http = require('http');

// First get token
const loginData = JSON.stringify({
  correo: 'admin@alfosac.pe',
  contrasena: 'admin'
});

const loginOptions = {
  hostname: 'localhost',
  port: 5000,
  path: '/api/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': loginData.length
  }
};

const loginReq = http.request(loginOptions, (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    const loginResponse = JSON.parse(data);
    const token = loginResponse.token;
    console.log('✓ Got token:', token.substring(0, 50) + '...\n');

    // Now use token to get current user
    const currentUserOptions = {
      hostname: 'localhost',
      port: 5000,
      path: '/api/me',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const currentUserReq = http.request(currentUserOptions, (res) => {
      let userData = '';
      res.on('data', chunk => { userData += chunk; });
      res.on('end', () => {
        try {
          const user = JSON.parse(userData);
          console.log('Current User (/api/me):');
          console.log('  ID:', user.id);
          console.log('  Name:', user.nombre);
          console.log('  Email:', user.correo);
          console.log('  Role:', user.rol);
          console.log('  Permissions count:', user.permisos ? user.permisos.length : 0);
          if (user.permisos) {
            console.log('\n  Permissions assigned to ADMIN role:');
            user.permisos.forEach(p => console.log(`    - ${p}`));
          }
        } catch (err) {
          console.log('Response from /api/me:', userData);
        }
      });
    });
    currentUserReq.on('error', console.error);
    currentUserReq.end();
  });
});

loginReq.on('error', console.error);
loginReq.write(loginData);
loginReq.end();
