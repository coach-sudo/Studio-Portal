import { Mail } from "lucide-react";
import { useState } from "react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";

export function MagicLinkLogin() {
  const [email,setEmail]=useState(""); const [status,setStatus]=useState<"idle"|"sending"|"sent"|"error">("idle");
  async function submit(event:React.FormEvent) { event.preventDefault(); setStatus("sending"); if(!isSupabaseConfigured||!supabase){setStatus("sent");return;} const {error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:`${window.location.origin}/portal`}}); setStatus(error?"error":"sent"); }
  return <main className="login-page"><div className="wordmark">Stage <b>&amp;</b> Story</div><form onSubmit={submit}><Mail/><h1>Open your studio workspace</h1><p>Enter the email your coach has on file. We’ll send a secure sign-in link.</p><label>Email<input type="email" required value={email} onChange={event=>setEmail(event.target.value)} placeholder="you@example.com"/></label><button disabled={status==="sending"}>{status==="sending"?"Sending…":"Email me a sign-in link"}</button>{status==="sent"&&<div role="status">Check your inbox. The link expires automatically.</div>}{status==="error"&&<div role="alert">We couldn’t send the link. Verify the address or contact your coach.</div>}</form></main>;
}
