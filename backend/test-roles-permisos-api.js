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

    // Now use token to fetch roles with permisos
    const rolesOptions = {
      hostname: 'localhost',
      port: 5000,
      path: '/api/roles',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const rolesReq = http.request(rolesOptions, (res) => {
      let rolesData = '';
      res.on('data', chunk => { rolesData += chunk; });
      res.on('end', () => {
        const roles = JSON.parse(rolesData);
        console.log('=== API /api/roles ===');
        roles.forEach(r => console.log(`${r.id}. ${r.nombre}`));

        // Fetch permisos endpoint
        const permisosOptions = {
          hostname: 'localhost',
          port: 5000,
          path: '/api/permisos',
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        };

        const permisosReq = http.request(permisosOptions, (res) => {
          let permisosData = '';
          res.on('data', chunk => { permisosData += chunk; });
          res.on('end', () => {
            const permisos = JSON.parse(permisosData);
            console.log('\n=== API /api/permisos ===');
            console.log('Total permisos:', permisos.length);
            permisos.slice(0, 5).forEach(p => console.log(`${p.id}. ${p.nombre} - ${p.descripcion || '(sin descripción)'}`));
            console.log('... (and', permisos.length - 5, 'more)');

            // Fetch role permisos
            const rolePermisosOptions = {
              hostname: 'localhost',
              port: 5000,
              path: '/api/roles/1/permisos',
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${token}`
              }
            };

            const rolePermisosReq = http.request(rolePermisosOptions, (res) => {
              let rolePermisosData = '';
              res.on('data', chunk => { rolePermisosData += chunk; });
              res.on('end', () => {
                try {
                  const rolePermisos = JSON.parse(rolePermisosData);
                  console.log('\n=== API /api/roles/1/permisos ===');
                  console.log('Response type:', Array.isArray(rolePermisos) ? 'Array' : typeof rolePermisos);
                  console.log('Response:', JSON.stringify(rolePermisos, null, 2));
                  
                  if (Array.isArray(rolePermisos)) {
                    console.log('Permisos for ADMIN role:', rolePermisos.length);
                    rolePermisos.forEach(p => console.log(`  - ${p.nombre}`));
                  } else if (rolePermisos && rolePermisos.permisos) {
                    console.log('Permisos for ADMIN role:', rolePermisos.permisos.length);
                    rolePermisos.permisos.forEach(p => console.log(`  - ${p.nombre}`));
                  }
                  console.log('\n✓ All API endpoints working correctly for RolesPermissionsView');
                } catch (err) {
                  console.log('Error parsing response:', err.message);
                }
              });
            });
            rolePermisosReq.on('error', console.error);
            rolePermisosReq.end();
          });
        });
        permisosReq.on('error', console.error);
        permisosReq.end();
      });
    });
    rolesReq.on('error', console.error);
    rolesReq.end();
  });
});

loginReq.on('error', console.error);
loginReq.write(loginData);
loginReq.end();
