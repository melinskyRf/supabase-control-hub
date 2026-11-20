import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Server-side resolver. Never put machineToken into NEXT_PUBLIC_* variables. */
export function controlHub(options:{ origin:string; applicationId:string; machineToken:string; onRouteChange?:(previousRef:string,newRef:string)=>Promise<void> }) {
  let current:{version:number;ref:string;client:SupabaseClient}|undefined;
  let failures=0;let retryAt=0;
  return {
    async client() {
      if(Date.now()<retryAt)throw new Error('Control Hub circuit breaker aberto');
      try{
        const response=await fetch(`${options.origin}/api/route?applicationId=${encodeURIComponent(options.applicationId)}`,{headers:{Authorization:`Bearer ${options.machineToken}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw new Error(`Control Hub route unavailable (${response.status})`);
        const route=await response.json();
        if(!current||current.version!==route.version){
          if(current){if(options.onRouteChange)await options.onRouteChange(current.ref,route.ref);await current.client.removeAllChannels();}
          current={version:route.version,ref:route.ref,client:createClient(route.url,route.publishableKey,{auth:{persistSession:false,autoRefreshToken:false}})};
        }
        failures=0;retryAt=0;return current.client;
      }catch(error){failures++;if(failures>=3)retryAt=Date.now()+30000;throw error;}
    },
    /** Resolve for every operation. Retaining client() results bypasses subsequent route checks. */
    async run<T>(operation:(client:SupabaseClient)=>Promise<T>){return operation(await this.client());},
  };
}
