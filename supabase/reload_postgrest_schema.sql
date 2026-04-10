-- Run in Supabase SQL Editor if inserts omit new columns (e.g. 23502 null on user_number)
-- after you added columns but the API still behaves like the old schema.
notify pgrst, 'reload schema';
