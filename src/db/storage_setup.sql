-- Storage Buckets Setup
-- 1. Dishes bucket
insert into storage.buckets (id, name, public) values ('dishes', 'dishes', true) on conflict do nothing;

-- 2. Avatars bucket
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict do nothing;

-- 3. Kitchens bucket
insert into storage.buckets (id, name, public) values ('kitchens', 'kitchens', true) on conflict do nothing;

-- Policies
create policy "Public Access" on storage.objects for select using ( bucket_id = 'dishes' or bucket_id = 'avatars' or bucket_id = 'kitchens' );
create policy "Authenticated Upload" on storage.objects for insert with check ( bucket_id in ('dishes', 'avatars', 'kitchens') );
