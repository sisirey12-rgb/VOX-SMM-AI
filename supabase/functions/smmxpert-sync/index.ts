// Compatibility endpoint for older VOXX catalogue clients.
Deno.serve(async req=>{
 const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"OPTIONS,POST"};
 if(req.method==="OPTIONS")return new Response(null,{headers});
 if(req.method!=="POST")return new Response(null,{status:405,headers});
 const auth=req.headers.get("Authorization");
 if(!auth)return new Response(null,{status:401,headers});
 try{
  const r=await fetch("https://voxx.in/api/operations",{method:"POST",headers:{Authorization:auth,"Content-Type":"application/json"},body:JSON.stringify({action:"sync"}),redirect:"error",signal:AbortSignal.timeout(20000)});
  return new Response(await r.text(),{status:r.status,headers:{...headers,"Content-Type":"application/json"}});
 }catch{return Response.json({error:"Sync unavailable"},{status:502,headers});}
});
