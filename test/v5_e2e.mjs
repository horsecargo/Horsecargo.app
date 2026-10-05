import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const fixtures=JSON.parse(await fs.readFile('work/v5-fixtures.json','utf8'));
await fs.mkdir('work/qa',{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1366,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
try {
  await page.goto('http://127.0.0.1:8787');
  await page.locator('input[type=email]').fill('warehouse@hc.test');
  await page.locator('input[type=password]').fill('Pass1234!');
  await page.locator('button[type=submit]').click();
  await page.locator('.sidebar').waitFor();
  await page.evaluate(()=>{localStorage.setItem('hc.lang','en');});await page.reload();
  for(const s of fixtures.shipments) {
    for(const type of ['grn','invoice']) {
      await page.goto(`http://127.0.0.1:8787/#/doc/${type}/${s.id}`);
      await page.locator('.cargo-items tbody tr').first().waitFor();
      assert.equal(await page.locator('.cargo-items tbody tr').count(),s.count);
      assert(!/Pending approval|Awaiting approval/.test(await page.locator('.doc').innerText()));
      if(type==='invoice') {
        for(const value of ['Horse Cargo Company Ltd.','015C00064HQ00','20410069001','44463499'])assert((await page.locator('.payment-info').innerText()).includes(value));
      }
      await page.screenshot({path:`work/qa/${type}-${s.count}.png`,fullPage:true});
      await page.pdf({path:`work/qa/${type}-${s.count}-print.pdf`,preferCSSPageSize:true,printBackground:true});
      const download=page.waitForEvent('download');await page.locator('#download-pdf').click();
      await (await download).saveAs(`work/qa/${type}-${s.count}-download.pdf`);
      const geometry=await page.evaluate(()=>Array.from(document.querySelectorAll('.doc th,.doc td')).map(n=>({left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right,scroll:n.scrollWidth,client:n.clientWidth})));
      assert(geometry.every(n=>n.scroll<=n.client+2),'Document cell overflow');
    }
  }
  await page.goto(`http://127.0.0.1:8787/#/doc/packing/${fixtures.list}`);
  await page.locator('.packing-summary').waitFor();
  assert((await page.locator('.doc').innerText()).includes('BOX 1'));
  await page.screenshot({path:'work/qa/packing-report.png',fullPage:true});
  await page.pdf({path:'work/qa/packing-print.pdf',preferCSSPageSize:true,printBackground:true});
  const download=page.waitForEvent('download');await page.locator('#download-pdf').click();await(await download).saveAs('work/qa/packing-download.pdf');
  await page.goto(`http://127.0.0.1:8787/#/doc/packing/${fixtures.longList}`);
  await page.locator('.packing-summary').waitFor();
  assert.equal(await page.locator('.packing-box-report tbody tr').count(),25);
  await page.pdf({path:'work/qa/packing-long-print.pdf',preferCSSPageSize:true,printBackground:true});
  const longDownload=page.waitForEvent('download');await page.locator('#download-pdf').click();await(await longDownload).saveAs('work/qa/packing-long-download.pdf');

  // Operate the actual responsive UI with real RPC writes.
  await page.goto('http://127.0.0.1:8787/#/packing-list');
  await page.locator('#new-list').click();await page.locator('#add-box').waitFor();
  await page.locator('#add-box').click();await page.locator('[data-add-item]').waitFor();
  const listURL=page.url();
  await page.locator('[data-add-item]').first().click();
  const form=page.locator('.pl-item-form');
  await form.locator('[name=shipment] option').nth(1).waitFor({state:'attached'});
  await form.locator('[name=search]').fill(fixtures.shipments[0].ref);
  await form.locator('[data-search]').click();
  await page.waitForFunction(()=>document.querySelector('select[name=shipment]').options.length===2);
  await form.locator('[name=shipment]').selectOption(fixtures.shipments[0].id);
  await form.locator('[name=item] option').nth(1).waitFor({state:'attached'});
  const item=await form.locator('[name=item] option').nth(1).getAttribute('value');
  await form.locator('[name=item]').selectOption(item);await form.locator('[name=qty]').fill('1');
  await form.locator('[type=submit]').click();await page.locator('.pl-item').waitFor();
  // Add a second shipment to the SAME box, then split its remaining quantity.
  await page.locator('[data-add-item]').first().click();
  await form.locator('[name=search]').fill(fixtures.shipments[1].ref);await form.locator('[data-search]').click();
  await page.waitForFunction(()=>document.querySelector('select[name=shipment]').options.length===2);
  await form.locator('[name=shipment]').selectOption(fixtures.shipments[1].id);
  await form.locator('[name=item] option').nth(1).waitFor({state:'attached'});
  const second=await form.locator('[name=item] option').nth(1).getAttribute('value');
  await form.locator('[name=item]').selectOption(second);await form.locator('[name=qty]').fill('1');
  await form.locator('[type=submit]').click();await page.waitForFunction(()=>document.querySelectorAll('.pl-item').length===2);
  await page.locator('#add-box').click();await page.waitForFunction(()=>document.querySelectorAll('.pl-box').length===2);
  await page.locator('[data-add-item]').nth(1).click();
  await form.locator('[name=search]').fill(fixtures.shipments[1].ref);await form.locator('[data-search]').click();
  await page.waitForFunction(()=>document.querySelector('select[name=shipment]').options.length===2);
  await form.locator('[name=shipment]').selectOption(fixtures.shipments[1].id);
  await form.locator('[name=item] option').nth(1).waitFor({state:'attached'});
  await form.locator('[name=item]').selectOption(second);await form.locator('[name=qty]').fill('1');
  await form.locator('[type=submit]').click();await page.waitForFunction(()=>document.querySelectorAll('.pl-item').length===3);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'work/qa/packing-mobile.png',fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile page overflow');
  const edit=page.locator('.pl-item').first(); const oldPage=await page.locator('#page').elementHandle();
  await edit.locator('input').fill('2');await edit.locator('[data-save-item]').click();
  await page.waitForFunction(old=>!old.isConnected,oldPage);await page.locator('[data-move-item]').first().waitFor();
  const moved=page.locator('.pl-item').filter({hasText:fixtures.shipments[0].ref});
  const target=await moved.locator('[data-move-item] option').nth(1).getAttribute('value');
  await moved.locator('[data-move-item]').selectOption(target);
  await page.waitForFunction(()=>document.querySelectorAll('.pl-box')[1]?.querySelectorAll('.pl-item').length===2);
  await page.locator('[data-remove-item]').first().click();await page.waitForFunction(()=>document.querySelectorAll('.pl-item').length===2);
  await page.waitForFunction(()=>document.querySelector('#toast-root').children.length===0);
  await page.screenshot({path:'work/qa/packing-mobile-edited.png',fullPage:true});
  await page.goto(listURL.replace('#/packing-list/','#/doc/packing/'));await page.locator('.doc').waitFor();
  await page.pdf({path:'work/qa/packing-ui-print.pdf',preferCSSPageSize:true,printBackground:true});
  await page.goto(listURL);await page.locator('#finalize').click();
  await page.locator('#modal-root .btn.primary').click();await page.waitForFunction(()=>!document.querySelector('#finalize'));
  await page.goto(`http://127.0.0.1:8787/#/shipment/${fixtures.a}`);await page.locator('#docs table').waitFor();
  assert.equal(await page.locator('a[href*="/waybill/"]').count(),0);
  assert.equal(await page.locator('#docs [data-approve]').count(),0); // warehouse lacks doc.approve
  await page.goto(`http://127.0.0.1:8787/#/doc/waybill/${fixtures.a}`);
  await page.getByText('Unknown document',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: browser document/PDF, actual packing workflow and mobile checks; no console/page errors.');
} catch(err) {
  await page.screenshot({path:'work/qa/failure.png',fullPage:true});
  console.log('browser errors',errors,'toast',await page.locator('#toast-root').innerText());
  throw err;
} finally {await browser.close();}
