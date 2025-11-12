const CACHE_NAME = 'storymap-v1';
const STATIC_CACHE = 'storymap-static-v1';
const DYNAMIC_CACHE = 'storymap-dynamic-v1';

// Assets to cache for app shell
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/main.js',
  '/favicon.png'
];

// Install event - cache app shell
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('Service Worker: Caching app shell');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => {
            return cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE;
          })
          .map((cacheName) => {
            console.log('Service Worker: Deleting old cache', cacheName);
            return caches.delete(cacheName);
          })
      );
    })
  );
  return self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Handle API requests with network-first strategy
  if (url.origin === 'https://story-api.dicoding.dev') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone the response
          const responseToCache = response.clone();
          // Cache the response
          caches.open(DYNAMIC_CACHE).then((cache) => {
            cache.put(request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          // If network fails, try to serve from cache
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // If no cache, return offline response
            return new Response(
              JSON.stringify({ error: true, message: 'Offline - Data tidak tersedia' }),
              {
                headers: { 'Content-Type': 'application/json' }
              }
            );
          });
        })
    );
    return;
  }

  // Handle static assets with cache-first strategy
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request).then((response) => {
        // Don't cache if not a valid response
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(STATIC_CACHE).then((cache) => {
          cache.put(request, responseToCache);
        });
        return response;
      });
    })
  );
});

// Push event - handle push notifications
self.addEventListener('push', (event) => {
  console.log('Service Worker: Push notification received');
  
  let notificationData = {
    title: 'Cerita Baru',
    body: 'Ada cerita baru yang ditambahkan!',
    icon: '/favicon.png',
    badge: '/favicon.png',
    tag: 'new-story',
    requireInteraction: false
  };

  // Parse push data if available
  if (event.data) {
    try {
      const data = event.data.json();
      notificationData = {
        title: data.title || 'Cerita Baru',
        body: data.body || data.message || 'Ada cerita baru yang ditambahkan!',
        icon: data.icon || '/favicon.png',
        badge: '/favicon.png',
        image: data.image || null,
        tag: data.tag || 'new-story',
        data: data.data || {},
        requireInteraction: false
      };
    } catch (e) {
      const text = event.data.text();
      if (text) {
        notificationData.body = text;
      }
    }
  }

  event.waitUntil(
    self.registration.showNotification(notificationData.title, {
      body: notificationData.body,
      icon: notificationData.icon,
      badge: notificationData.badge,
      image: notificationData.image,
      tag: notificationData.tag,
      data: notificationData.data,
      requireInteraction: notificationData.requireInteraction,
      actions: [
        {
          action: 'view',
          title: 'Lihat Cerita',
          icon: '/favicon.png'
        },
        {
          action: 'close',
          title: 'Tutup'
        }
      ],
      vibrate: [200, 100, 200],
      timestamp: Date.now()
    })
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('Service Worker: Notification clicked', event);
  
  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  // Default action or 'view' action - navigate to home page
  const urlToOpen = event.notification.data?.url || self.location.origin + '/#/';
  
  event.waitUntil(
    clients.matchAll({ 
      type: 'window', 
      includeUncontrolled: true 
    }).then((clientList) => {
      // Check if there's already a window/tab open
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        // If client is visible and matches our origin, focus it
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          // Navigate to home page if needed
          if (event.notification.data?.url) {
            return client.focus().then(() => {
              client.navigate?.(urlToOpen) || (client.url = urlToOpen);
            });
          }
          return client.focus();
        }
      }
      // If no window is open, open a new one
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// Background sync (for offline sync)
self.addEventListener('sync', (event) => {
  console.log('Service Worker: Background sync', event.tag);
  if (event.tag === 'sync-stories') {
    event.waitUntil(syncStories());
  }
});

async function syncStories() {
  console.log('Service Worker: Syncing stories...');
  try {
    // Open IndexedDB and sync unsynced data
    // This is a placeholder - in a real app, you would sync with API
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('StoryMapDB', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const transaction = db.transaction(['favorites'], 'readonly');
    const store = transaction.objectStore('favorites');
    const getAllRequest = store.getAll();

    return new Promise((resolve, reject) => {
      getAllRequest.onsuccess = async () => {
        const favorites = getAllRequest.result;
        const unsynced = favorites.filter(f => !f.synced);
        console.log('Service Worker: Found', unsynced.length, 'unsynced favorites');
        
        // In a real app, send to API here
        // For now, we'll mark as synced
        if (unsynced.length > 0) {
          const writeTransaction = db.transaction(['favorites'], 'readwrite');
          const writeStore = writeTransaction.objectStore('favorites');
          
          for (const favorite of unsynced) {
            favorite.synced = true;
            writeStore.put(favorite);
          }
          
          writeTransaction.oncomplete = () => {
            console.log('Service Worker: Sync completed');
            resolve();
          };
          
          writeTransaction.onerror = () => {
            reject(writeTransaction.error);
          };
        } else {
          resolve();
        }
      };
      
      getAllRequest.onerror = () => {
        reject(getAllRequest.error);
      };
    });
  } catch (error) {
    console.error('Service Worker: Sync error', error);
    throw error;
  }
}

