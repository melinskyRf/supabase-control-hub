import { test, expect } from '@playwright/test';
test('private dashboard displays login and refuses unauthenticated access',async({page,request})=>{
 await page.route('**/api/health',route=>route.fulfill({json:{ok:true,configured:true}}));
 await page.goto('/');await expect(page.getByRole('button',{name:'Entrar com segurança'})).toBeVisible();
 await expect(page.getByLabel('Código do autenticador')).toHaveCount(0);
 const response=await request.get('/api/state');expect(response.status()).toBe(401);
 const mutation=await request.post('/api/action',{data:{action:'metrics.collect',input:{}}});expect(mutation.status()).toBe(401);
});

test('first access explains configuration and automatically returns to the password login',async({page})=>{
 let configured=false;
 await page.route('**/api/state',route=>route.fulfill({status:401,json:{error:'Faça login para continuar.'}}));
 await page.route('**/api/health',route=>route.fulfill({json:{ok:true,configured}}));
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Configure seu primeiro acesso'})).toBeVisible();
 await expect(page.getByRole('region',{name:'Primeiro acesso'})).toContainText('INICIAR.cmd');
 await expect(page.getByRole('button',{name:'Entrar com segurança'})).toHaveCount(0);
 configured=true;
 await expect(page.getByRole('button',{name:'Entrar com segurança'})).toBeVisible();
});
test('authorized account form sends the server action contract',async({page})=>{
 const state={connections:[],organizations:[],projects:[],applications:[],members:[],observations:[],limits:[],operations:[],logs:[],backups:[],schedules:[],capabilities:{oauth:false},serverTime:new Date().toISOString()};
 await page.route('**/api/state',route=>route.fulfill({json:state}));
 let payload:any;
 await page.route('**/api/action',async route=>{payload=route.request().postDataJSON();await route.fulfill({json:{id:'connection-test'}});});
 await page.goto('/');await page.getByRole('button',{name:'Accounts',exact:true}).click();
 await page.getByLabel('Nome da conexão',{exact:true}).fill('Conta reserva');
 await page.getByLabel('Identificador da conta',{exact:true}).fill('account-two');
 await page.getByLabel('Personal Access Token',{exact:true}).fill('private-example-token');
 await page.getByRole('button',{name:'Conectar conta',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Operação concluída');
 expect(payload).toEqual({action:'connection.create',input:{name:'Conta reserva',accountId:'account-two',token:'private-example-token'}});
});
