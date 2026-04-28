import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://vkuhcjcpzhgfszrcavhr.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZrdWhjamNwemhnZnN6cmNhdmhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMzY4MTcsImV4cCI6MjA4ODgxMjgxN30.wcIjL7nQb8LSgWJM4Yj3P0iBwKestSCjkJI8CvVrYp4";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const PORTFOLIO_USER_ID = "cruise";
