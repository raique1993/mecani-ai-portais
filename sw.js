import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB=Deno.env.get("SUPABASE_URL")!;
const SK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb=createClient(SB,SK);

// IPs bloqueados permanentemente
const BLOCKED_IPS: string[] = [];

// Endpoints e limites (requests por minuto)
const RATE_LIMITS: Record<string,number> = {
  "orchestrator": 120,
  "checkin-v2": 60,
  "agendamento": 30,
  "onboarding": 5,
  "email": 20,
};

// export async function checkSecurity(req: Request, endpoint: string): Promise<Response|null> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ua = req.headers.get("user-agent") || "";
  
  // 1. IP bloqueado
  if (BLOCKED_IPS.includes(ip)) {
    await logThreat(ip, endpoint, "IP_BLOCKED", ua);
    return new Response(JSON.stringify({error:"Forbidden"}), {status:403});
  }
  
  // 2. Rate limiting
  const limit = RATE_LIMITS[endpoint] || 60;
  const windowStart = new Date(Date.now() - 60000).toISOString();
  
  const {count} = await sb.from("_rate_limit")
    .select("*", {count:"exact", head:true})
    .eq("ip", ip).eq("endpoint", endpoint)
    .gte("created_at", windowStart);
  
  if ((count || 0) >= limit) {
    await logThreat(ip, endpoint, "RATE_LIMITED", ua);
    return new Response(JSON.stringify({error:"Too many requests"}), {
      status:429, 
      headers:{"Retry-After":"60"}
    });
  }
  
  // 3. Registrar hit
  await sb.from("_rate_limit").insert({ip, endpoint, hits:1}).catch(()=>{});
  
  // 4. Detectar bots maliciosos
  const maliciousBots = ["sqlmap", "nikto", "nmap", "masscan", "zgrab", "python-requests/2.18"];
  if (maliciousBots.some(bot => ua.toLowerCase().includes(bot))) {
    await logThreat(ip, endpoint, "MALICIOUS_BOT", ua);
    return new Response(JSON.stringify({error:"Forbidden"}), {status:403});
  }
  
  return null; // passar
}

async function logThreat(ip: string, endpoint: string, tipo: string, ua: string) {
  await sb.from("audit_log").insert({
    acao: tipo,
    tabela: endpoint,
    ip,
    user_agent: ua,
  }).catch(()=>{});
}

Deno.serve(async (req) => {
  return new Response(JSON.stringify({status:"security module active"}), {
    headers:{"Content-Type":"application/json"}
  });
});
