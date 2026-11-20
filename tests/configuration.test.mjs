import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configurationIssues } from '../src/core/configuration.mjs';

const valid = {HUB_ORIGIN:'http://127.0.0.1:3000',HUB_ENCRYPTION_KEY:'a'.repeat(64),ADMIN_PASSWORD_HASH:`${'b'.repeat(32)}:${'c'.repeat(128)}`};
test('configuration requires complete credentials without returning their values',()=>{
 assert.deepEqual(configurationIssues(valid),[]);
 assert.equal(configurationIssues({}).length,2);
 for(const key of ['HUB_ENCRYPTION_KEY','ADMIN_PASSWORD_HASH']){
  const issues=configurationIssues({...valid,[key]:'private-invalid-value'});
  assert.equal(issues.length,1);assert.ok(issues[0].includes(key));assert.ok(!issues[0].includes('private-invalid-value'));
 }
});
test('configuration requires safe origins and an independent production database',()=>{
 for(const origin of ['http://example.com','https://user:secret@example.com','https://example.com/path','https://example.com/?q=secret','file:///tmp','invalid']){
  assert.ok(configurationIssues({...valid,HUB_ORIGIN:origin}).some(i=>i.startsWith('HUB_ORIGIN:')));
 }
 assert.equal(configurationIssues({...valid,NODE_ENV:'production'}).length,2);
 assert.deepEqual(configurationIssues({...valid,NODE_ENV:'production',HUB_ORIGIN:'https://hub.example.com',DATABASE_URL:'postgresql://hub:secret@postgres/control_hub'}),[]);
 assert.deepEqual(configurationIssues({...valid,HUB_ORIGIN:'http://[::1]:3000'}),[]);
});
