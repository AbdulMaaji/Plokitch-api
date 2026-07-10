Overview

This document explains how to: 

- Upload multiple dish images to Supabase Storage (bucket `dishes`).
- Save the resulting public URLs into the backend `menu_item.imageUrls` column via the existing vendor menu endpoints.
- Render a client-side slideshow/carousel that users can swipe or click through and reorder images.

Backend

1. Database
- A new migration was added: `drizzle/0010_add_menu_item_image_urls.sql` which adds `image_urls jsonb DEFAULT '[]'` to `menu_item`.
- `src/db/schema.ts` now includes `imageUrls: jsonb("image_urls").$type<string[]>().default([])` on `menu_item`.

2. API
- `POST /api/vendors/:id/menu` and `PATCH /api/vendors/:vendorId/menu/:itemId` accept `imageUrls` (array of public image URLs) in the request body.
- The existing GET endpoints already return `menuItems` which will include `imageUrls`.

Client flow (React + Supabase)

Install Supabase client:

```bash
npm install @supabase/supabase-js
```

Upload images and save menu item with `imageUrls`:

```tsx
import { createClient } from '@supabase/supabase-js';
import React, { useState } from 'react';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

export default function UploadImages({ vendorId, onSaved }: { vendorId: string; onSaved?: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  async function handleUpload(itemData: any) {
    if (files.length === 0) return; 
    setUploading(true);

    try {
      const urls: string[] = [];
      for (const file of files) {
        const path = `dishes/${Date.now()}_${file.name}`;
        const { data, error } = await supabase.storage.from('dishes').upload(path, file, { cacheControl: '3600', upsert: false });
        if (error) throw error;
        const publicUrl = supabase.storage.from('dishes').getPublicUrl(path).data.publicUrl;
        urls.push(publicUrl);
      }

      // Call your backend to create the menu item including imageUrls
      await fetch(`/api/vendors/${vendorId}/menu`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...itemData,
          imageUrls: urls,
        }),
      });

      onSaved?.();
    } catch (err) {
      console.error('Upload failed', err);
      alert('Image upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <input type="file" multiple accept="image/*" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
      <button disabled={uploading} onClick={() => handleUpload({ name: 'New Dish', price: '1000' })}>
        {uploading ? 'Uploading...' : 'Upload & Save'}
      </button>
    </div>
  );
}
```

Slideshow / Carousel component

This is a minimal accessible slideshow that supports touch swiping and arrow navigation and lets the user reorder images by drag-and-drop.

```tsx
import React, { useState, useRef, useEffect } from 'react';

export default function DishCarousel({ images, onReorder }: { images: string[]; onReorder?: (newOrder: string[]) => void }) {
  const [index, setIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setIndex(0), [images]);

  function prev() { setIndex((i) => (i - 1 + images.length) % images.length); }
  function next() { setIndex((i) => (i + 1) % images.length); }

  // Basic swipe handlers
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let startX = 0;
    function onTouchStart(e: TouchEvent) { startX = e.touches[0].clientX; }
    function onTouchEnd(e: TouchEvent) {
      const diff = e.changedTouches[0].clientX - startX;
      if (Math.abs(diff) > 50) {
        if (diff < 0) next(); else prev();
      }
    }
    el.addEventListener('touchstart', onTouchStart);
    el.addEventListener('touchend', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [images.length]);

  // Simple drag-and-drop reorder
  function onDragStart(e: React.DragEvent, i: number) { e.dataTransfer.setData('text/plain', String(i)); }
  function onDrop(e: React.DragEvent, toIndex: number) {
    const from = Number(e.dataTransfer.getData('text/plain'));
    if (isNaN(from)) return;
    const copy = [...images];
    const [moved] = copy.splice(from, 1);
    copy.splice(toIndex, 0, moved);
    onReorder?.(copy);
  }
  function onDragOver(e: React.DragEvent) { e.preventDefault(); }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', transform: `translateX(${-index * 100}%)`, transition: 'transform 300ms ease' }}>
        {images.map((src, i) => (
          <div key={src} style={{ minWidth: '100%', userSelect: 'none' }}
               draggable onDragStart={(e) => onDragStart(e, i)} onDragOver={onDragOver} onDrop={(e) => onDrop(e, i)}>
            <img src={src} alt={`Dish image ${i + 1}`} style={{ width: '100%', height: 'auto', display: 'block' }} />
          </div>
        ))}
      </div>

      <button onClick={prev} aria-label="Previous image" style={{ position: 'absolute', left: 8, top: '50%' }}>‹</button>
      <button onClick={next} aria-label="Next image" style={{ position: 'absolute', right: 8, top: '50%' }}>›</button>

      <div style={{ textAlign: 'center', marginTop: 8 }}>
        {images.map((_, i) => (
          <button key={i} onClick={() => setIndex(i)} aria-label={`Go to image ${i + 1}`} style={{ margin: '0 4px' }}>{i + 1}</button>
        ))}
      </div>
    </div>
  );
}
```

Persisting reordered images

- When the user reorders images in the carousel, call the backend `PATCH /api/vendors/:vendorId/menu/:itemId` with `imageUrls: newOrderArray` to persist the new order.

Example:

```ts
await fetch(`/api/vendors/${vendorId}/menu/${itemId}`, {
  method: 'PATCH',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ imageUrls: newOrder }),
});
```

Security notes

- Ensure uploads are authenticated (the Supabase policy allows authenticated uploads to `dishes`).
- Validate image URLs on the backend if you accept arbitrary URLs (the current flow expects you to upload to Supabase and store public URLs).

Next steps

- Add file upload endpoints if you prefer the backend to proxy uploads instead of direct Supabase uploads.
- Add UI polish: lazy-loading, progressive image sizes, pinch-zoom, and accessible labels.
