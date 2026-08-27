/* ============================================================
   push.js — Browser Web Push client (Requester notifications)
   Injected by main.js on every page while the user is logged in.

   Flow:
     1. Register the service worker (/sw.js, scope "/").
     2. Ask the browser for notification permission (on login).
     3. If granted, create a PushSubscription with the backend's
        VAPID public key and store it server-side (linked to user id).
     4. The backend then pushes status updates straight to the browser.
   ============================================================ */

(function () {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return;
  }

  /* Convert base64url VAPID key → Uint8Array for PushManager */
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw     = atob(base64);
    const array   = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) array[i] = raw.charCodeAt(i);
    return array;
  }

  async function fetchPublicKey() {
    try {
      const res = await fetch(`${API_BASE}/push/vapid-public-key`);
      if (!res.ok) return null;
      const json = await res.json();
      return (json.data && json.data.publicKey) || null;
    } catch (_) { return null; }
  }

  async function saveSubscription(subscription) {
    await apiRequest('/push/subscribe', {
      method: 'POST',
      body: {
        endpoint: subscription.endpoint,
        keys:     subscription.toJSON().keys,
        userAgent: navigator.userAgent,
      },
    });
  }

  async function subscribe() {
    const publicKey = await fetchPublicKey();
    if (!publicKey) return;                     // VAPID not configured — skip silently

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    if (subscription) await saveSubscription(subscription);
  }

  /* Logout/login must NOT lose the subscription: we keep the browser
     subscription and simply upsert it against the current account. */

  navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(() => {
    if (Notification.permission === 'granted') {
      subscribe();
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') subscribe();
      });
    }
  }).catch(() => { /* SW unavailable — in-app notifications still work */ });

  /* Re-subscribe when the browser rotates the subscription */
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'PUSH_RESUBSCRIBE') subscribe();
  });
})();