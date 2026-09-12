import {it,expect} from 'vitest';
import {Writable} from 'node:stream';
import {createLogger} from '../../src/shared/logger.js';
import {loadEnv} from '../../src/config/env.js';
it('does not log callback codes, query state or browser cookies',()=>{
 let output='';const stream=new Writable({write(chunk,_encoding,done){output+=String(chunk);done();}});
 const logger=createLogger(loadEnv({NODE_ENV:'test',DATABASE_URL:'postgres://fixture'}),{},stream);
 logger.info({req:{method:'GET',url:'/api/auth/zhihu/callback?authorization_code=fixture-secret&state=fixture-state',headers:{cookie:'fixture-cookie'}}},'incoming request');
 expect(output).toContain('/api/auth/zhihu/callback');expect(output).not.toContain('fixture-secret');expect(output).not.toContain('fixture-state');expect(output).not.toContain('fixture-cookie');
});
