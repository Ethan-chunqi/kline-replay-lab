// IndexedDB keeps imported candles and accounts on the device, per training session.
export async function openStorage() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('wavelab-training', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('sessions', { keyPath: 'id' });
      request.result.createObjectStore('settings');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const read = (store, op, key) =>
    new Promise((resolve, reject) => {
      const request = db.transaction(store).objectStore(store)[op](key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  return {
    load: () => Promise.all([read('sessions', 'getAll'), read('settings', 'get', 'active')]),
    save(session) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['sessions', 'settings'], 'readwrite');
        tx.objectStore('sessions').put(session);
        tx.objectStore('settings').put(session.id, 'active');
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
    },
  };
}
