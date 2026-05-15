const http = require('http');

// Simular una solicitud al endpoint /api/mis-compras con un usuario que tiene GESTIONAR_COMPRAS
const data = JSON.stringify({
  user: {
    id: 1,
    nombre: 'Admin',
    rol: 'ADMIN',
    rol_id: 1,
  }
});

const options = {
  hostname: 'localhost',
  port: 5000,
  path: '/api/mis-compras',
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
  }
};

const req = http.request(options, (res) => {
  let responseData = '';

  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    console.log('Respuesta del endpoint /api/mis-compras:');
    try {
      const parsed = JSON.parse(responseData);
      console.log(JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log(responseData);
    }
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
});

req.end();



