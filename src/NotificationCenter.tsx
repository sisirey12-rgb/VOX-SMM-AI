import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { db } from "./catalogue";
import { GlassDialog, Loading } from "./UltraGlass";

type Notice = { id: number; title: string; body: string; created_at: string | null };

export function NotificationCenter({ userId, openPage }: { userId: string; openPage: () => void }) {
  const storageKey = "voxx-notices-read/" + userId;
  const [seen, setSeen] = useState(() => {
    try { return Number(localStorage.getItem(storageKey)) || 0; }
    catch { return 0; }
  });
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [error, setError] = useState(false);
  const [revision, refresh] = useState(0);
  useEffect(() => {
    const client = db;
    if (!client) return;
    let active = true;
    async function load() {
      try {
        const result = await client!.from("voxx_notices")
          .select("id,title,body,created_at").order("id", { ascending: false }).limit(12);
        if (!active) return;
        if (result.error) throw result.error;
        setNotices(result.data ?? []);
        setError(false);
      } catch {
        if (active) setError(true);
      }
    }
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [userId, revision]);

  const unread = notices?.filter((notice) => notice.id > seen).length ?? 0;
  return (
    <GlassDialog title="Recent notifications" triggerLabel={unread ? "Notifications, " + unread + " unread" : "Notifications"}
      onOpen={() => refresh((value) => value + 1)}
      trigger={<><Bell size={17} aria-hidden="true" />{unread > 0 && <i className="nexus-unread" aria-hidden="true" />}</>}>
      {(close) => <div className="nexus-notifications">
        {error && <p role="alert">Notifications could not refresh.</p>}
        {!error && !notices && <Loading label="Loading notifications" />}
        {notices?.length === 0 && <p>No announcements yet.</p>}
        {notices && notices.length > 0 && (
          <ol>{notices.map((notice) => (
            <li key={notice.id}>
              <small>Announcement{notice.id > seen ? " · Unread" : ""}</small>
              <strong>{notice.title}</strong>
              <p>{notice.body}</p>
              {notice.created_at && <time dateTime={notice.created_at}>{new Date(notice.created_at).toLocaleString()}</time>}
            </li>
          ))}</ol>
        )}
        <div className="nexus-notification-actions">
          <button className="glass-action" type="button" onClick={() => { close(); openPage(); }}>View all notifications</button>
          {unread > 0 && notices && <button className="glass-action" type="button" onClick={() => {
            const latest = Math.max(seen, ...notices.map((notice) => notice.id));
            setSeen(latest);
            try { localStorage.setItem(storageKey, String(latest)); } catch { /* Device storage is optional. */ }
          }}>Mark shown as read</button>}
        </div>
      </div>}
    </GlassDialog>
  );
}
