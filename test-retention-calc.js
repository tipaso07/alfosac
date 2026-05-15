#!/usr/bin/env node

/**
 * Test script to validate retention calculation logic
 * Usage: node test-retention-calc.js
 */

const normalize = (value) => String(value || '').trim().toUpperCase();

const testRetentionCalc = () => {
  console.log('\\n=== RETENTION CALCULATION TEST ===\\n');

  // Test Case 1: PEN currency, total > 700, retencion='SI', descuento=5%
  console.log('TEST CASE 1: PEN, total=900, retencion=SI, descuento=5%');
  const provider1 = {
    retencion: 'SI',
    descuento: 5,
  };
  const compra1 = {
    subtotal: 750,
    igv: 135, // 750 * 0.18
    costo_envio: 0,
    otros_costos: 0,
    moneda: 'SOLES PEN',
    total_base: 885,
  };

  const providerRetencionFlag1 = String(provider1.retencion || '').trim().toUpperCase() === 'SI';
  const descuentoNum1 = Number(provider1.descuento ?? 0);
  const monedaNorm1 = String(compra1.moneda || '').toUpperCase();
  const isUsd1 = /USD|US\$|\$|DOL|DÓLAR|DOLAR/.test(monedaNorm1);
  const isPen1 = /PEN|SOL/.test(monedaNorm1);
  const totalBase1 = compra1.subtotal + compra1.igv + compra1.costo_envio + compra1.otros_costos;
  const totalEnSoles1 = isUsd1 ? Number((totalBase1 * 3.5).toFixed(2)) : totalBase1;
  const superaUmbral1 = (isPen1 && totalBase1 > 700) || (isUsd1 && totalEnSoles1 > 700);
  const aplicaRetencion1 = providerRetencionFlag1 && descuentoNum1 > 0 && superaUmbral1;

  console.log(`  provider.retencion: ${provider1.retencion}`);
  console.log(`  provider.descuento: ${provider1.descuento}`);
  console.log(`  providerRetencionFlag: ${providerRetencionFlag1}`);
  console.log(`  descuentoNum: ${descuentoNum1}`);
  console.log(`  moneda: ${compra1.moneda}`);
  console.log(`  isPen: ${isPen1}`);
  console.log(`  isUsd: ${isUsd1}`);
  console.log(`  subtotal: ${compra1.subtotal}`);
  console.log(`  igv: ${compra1.igv}`);
  console.log(`  costo_envio: ${compra1.costo_envio}`);
  console.log(`  otros_costos: ${compra1.otros_costos}`);
  console.log(`  totalBase: ${totalBase1}`);
  console.log(`  totalEnSoles: ${totalEnSoles1}`);
  console.log(`  superaUmbral (${isPen1 ? 'PEN' : isUsd1 ? 'USD' : '?'} > 700): ${superaUmbral1}`);
  console.log(`  ✓ EXPECTED: aplicaRetencion = true`);
  console.log(`  ✓ ACTUAL: aplicaRetencion = ${aplicaRetencion1}`);
  console.log(`  ${aplicaRetencion1 ? '✓ PASS' : '✗ FAIL'}`);
  console.log();

  // Test Case 2: USD currency, total in USD should be converted to > 700 soles
  console.log('TEST CASE 2: USD, total=250 USD (875 soles > 700), retencion=SI, descuento=3%');
  const provider2 = {
    retencion: 'SI',
    descuento: 3,
  };
  const compra2 = {
    subtotal: 200,
    igv: 36, // 200 * 0.18
    costo_envio: 0,
    otros_costos: 0,
    moneda: 'USD DOLAR',
    total_base: 236,
  };

  const providerRetencionFlag2 = String(provider2.retencion || '').trim().toUpperCase() === 'SI';
  const descuentoNum2 = Number(provider2.descuento ?? 0);
  const monedaNorm2 = String(compra2.moneda || '').toUpperCase();
  const isUsd2 = /USD|US\$|\$|DOL|DÓLAR|DOLAR/.test(monedaNorm2);
  const isPen2 = /PEN|SOL/.test(monedaNorm2);
  const totalBase2 = compra2.subtotal + compra2.igv + compra2.costo_envio + compra2.otros_costos;
  const totalEnSoles2 = isUsd2 ? Number((totalBase2 * 3.5).toFixed(2)) : totalBase2;
  const superaUmbral2 = (isPen2 && totalBase2 > 700) || (isUsd2 && totalEnSoles2 > 700);
  const aplicaRetencion2 = providerRetencionFlag2 && descuentoNum2 > 0 && superaUmbral2;

  console.log(`  provider.retencion: ${provider2.retencion}`);
  console.log(`  provider.descuento: ${provider2.descuento}`);
  console.log(`  providerRetencionFlag: ${providerRetencionFlag2}`);
  console.log(`  descuentoNum: ${descuentoNum2}`);
  console.log(`  moneda: ${compra2.moneda}`);
  console.log(`  isPen: ${isPen2}`);
  console.log(`  isUsd: ${isUsd2}`);
  console.log(`  subtotal: ${compra2.subtotal}`);
  console.log(`  igv: ${compra2.igv}`);
  console.log(`  costo_envio: ${compra2.costo_envio}`);
  console.log(`  otros_costos: ${compra2.otros_costos}`);
  console.log(`  totalBase: ${totalBase2}`);
  console.log(`  totalBase in Soles: ${totalEnSoles2} (${totalBase2} * 3.5)`);
  console.log(`  superaUmbral (USD ${totalEnSoles2} soles > 700): ${superaUmbral2}`);
  console.log(`  ✓ EXPECTED: aplicaRetencion = true`);
  console.log(`  ✓ ACTUAL: aplicaRetencion = ${aplicaRetencion2}`);
  console.log(`  ${aplicaRetencion2 ? '✓ PASS' : '✗ FAIL'}`);
  console.log();

  // Test Case 3: retencion='NO' should not apply retention
  console.log('TEST CASE 3: PEN, total=900, retencion=NO (even though descuento=5%), should NOT apply');
  const provider3 = {
    retencion: 'NO',
    descuento: 5,
  };
  const compra3 = {
    subtotal: 750,
    igv: 135,
    costo_envio: 0,
    otros_costos: 0,
    moneda: 'SOLES',
    total_base: 885,
  };

  const providerRetencionFlag3 = String(provider3.retencion || '').trim().toUpperCase() === 'SI';
  const descuentoNum3 = Number(provider3.descuento ?? 0);
  const monedaNorm3 = String(compra3.moneda || '').toUpperCase();
  const isUsd3 = /USD|US\$|\$|DOL|DÓLAR|DOLAR/.test(monedaNorm3);
  const isPen3 = /PEN|SOL/.test(monedaNorm3);
  const totalBase3 = compra3.subtotal + compra3.igv + compra3.costo_envio + compra3.otros_costos;
  const totalEnSoles3 = isUsd3 ? Number((totalBase3 * 3.5).toFixed(2)) : totalBase3;
  const superaUmbral3 = (isPen3 && totalBase3 > 700) || (isUsd3 && totalEnSoles3 > 700);
  const aplicaRetencion3 = providerRetencionFlag3 && descuentoNum3 > 0 && superaUmbral3;

  console.log(`  provider.retencion: ${provider3.retencion}`);
  console.log(`  provider.descuento: ${provider3.descuento}`);
  console.log(`  providerRetencionFlag: ${providerRetencionFlag3}`);
  console.log(`  descuentoNum: ${descuentoNum3}`);
  console.log(`  moneda: ${compra3.moneda}`);
  console.log(`  isPen: ${isPen3}`);
  console.log(`  totalBase: ${totalBase3}`);
  console.log(`  superaUmbral: ${superaUmbral3}`);
  console.log(`  ✓ EXPECTED: aplicaRetencion = false`);
  console.log(`  ✓ ACTUAL: aplicaRetencion = ${aplicaRetencion3}`);
  console.log(`  ${!aplicaRetencion3 ? '✓ PASS' : '✗ FAIL'}`);
  console.log();

  // Test Case 4: descuento=0 should not apply retention
  console.log('TEST CASE 4: PEN, total=900, retencion=SI, descuento=0, should NOT apply');
  const provider4 = {
    retencion: 'SI',
    descuento: 0,
  };
  const compra4 = {
    subtotal: 750,
    igv: 135,
    costo_envio: 0,
    otros_costos: 0,
    moneda: 'SOL',
    total_base: 885,
  };

  const providerRetencionFlag4 = String(provider4.retencion || '').trim().toUpperCase() === 'SI';
  const descuentoNum4 = Number(provider4.descuento ?? 0);
  const monedaNorm4 = String(compra4.moneda || '').toUpperCase();
  const isUsd4 = /USD|US\$|\$|DOL|DÓLAR|DOLAR/.test(monedaNorm4);
  const isPen4 = /PEN|SOL/.test(monedaNorm4);
  const totalBase4 = compra4.subtotal + compra4.igv + compra4.costo_envio + compra4.otros_costos;
  const totalEnSoles4 = isUsd4 ? Number((totalBase4 * 3.5).toFixed(2)) : totalBase4;
  const superaUmbral4 = (isPen4 && totalBase4 > 700) || (isUsd4 && totalEnSoles4 > 700);
  const aplicaRetencion4 = providerRetencionFlag4 && descuentoNum4 > 0 && superaUmbral4;

  console.log(`  provider.retencion: ${provider4.retencion}`);
  console.log(`  provider.descuento: ${provider4.descuento}`);
  console.log(`  providerRetencionFlag: ${providerRetencionFlag4}`);
  console.log(`  descuentoNum: ${descuentoNum4}`);
  console.log(`  descuentoNum > 0: ${descuentoNum4 > 0}`);
  console.log(`  moneda: ${compra4.moneda}`);
  console.log(`  totalBase: ${totalBase4}`);
  console.log(`  superaUmbral: ${superaUmbral4}`);
  console.log(`  ✓ EXPECTED: aplicaRetencion = false`);
  console.log(`  ✓ ACTUAL: aplicaRetencion = ${aplicaRetencion4}`);
  console.log(`  ${!aplicaRetencion4 ? '✓ PASS' : '✗ FAIL'}`);
  console.log();

  // Test Case 5: total < 700 should not apply retention
  console.log('TEST CASE 5: PEN, total=600 < 700, retencion=SI, descuento=5%, should NOT apply');
  const provider5 = {
    retencion: 'SI',
    descuento: 5,
  };
  const compra5 = {
    subtotal: 500,
    igv: 90, // 500 * 0.18
    costo_envio: 0,
    otros_costos: 0,
    moneda: 'NUEVOS SOLES',
    total_base: 590,
  };

  const providerRetencionFlag5 = String(provider5.retencion || '').trim().toUpperCase() === 'SI';
  const descuentoNum5 = Number(provider5.descuento ?? 0);
  const monedaNorm5 = String(compra5.moneda || '').toUpperCase();
  const isUsd5 = /USD|US\$|\$|DOL|DÓLAR|DOLAR/.test(monedaNorm5);
  const isPen5 = /PEN|SOL/.test(monedaNorm5);
  const totalBase5 = compra5.subtotal + compra5.igv + compra5.costo_envio + compra5.otros_costos;
  const totalEnSoles5 = isUsd5 ? Number((totalBase5 * 3.5).toFixed(2)) : totalBase5;
  const superaUmbral5 = (isPen5 && totalBase5 > 700) || (isUsd5 && totalEnSoles5 > 700);
  const aplicaRetencion5 = providerRetencionFlag5 && descuentoNum5 > 0 && superaUmbral5;

  console.log(`  provider.retencion: ${provider5.retencion}`);
  console.log(`  provider.descuento: ${provider5.descuento}`);
  console.log(`  moneda: ${compra5.moneda}`);
  console.log(`  totalBase: ${totalBase5} < 700`);
  console.log(`  superaUmbral: ${superaUmbral5}`);
  console.log(`  ✓ EXPECTED: aplicaRetencion = false`);
  console.log(`  ✓ ACTUAL: aplicaRetencion = ${aplicaRetencion5}`);
  console.log(`  ${!aplicaRetencion5 ? '✓ PASS' : '✗ FAIL'}`);
  console.log();

  console.log('=== END OF TEST ===\\n');
};

testRetentionCalc();
