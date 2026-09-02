import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }
const hiddenKey = "coachd-install-prompt-complete";

export function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent>();
  useEffect(() => {
    if (localStorage.getItem(hiddenKey)) return;
    const ready = (incoming: Event) => { incoming.preventDefault(); setEvent(incoming as InstallEvent); };
    const installed = () => { localStorage.setItem(hiddenKey, "installed"); setEvent(undefined); };
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", installed);
    return () => { window.removeEventListener("beforeinstallprompt", ready); window.removeEventListener("appinstalled", installed); };
  }, []);
  if (!event) return null;
  const dismiss = () => { localStorage.setItem(hiddenKey, "dismissed"); setEvent(undefined); };
  const install = async () => { await event.prompt(); const choice=await event.userChoice; localStorage.setItem(hiddenKey, choice.outcome); setEvent(undefined); };
  return <aside className="install-prompt" aria-label="Install Coach’D"><Download/><div><strong>Install Coach’D</strong><small>Open your studio faster from this device.</small></div><button className="primary-button" onClick={()=>void install()}>Install</button><button aria-label="Dismiss install prompt" onClick={dismiss}><X/></button></aside>;
}
