-- ============================================================
-- 044: user_quotes — UPDATE policy для is_public + грант UPDATE
--
-- Миграция 014 добавила колонку is_public и политику на SELECT, но про
-- UPDATE забыла. При попытке переключить тумблер «только я / публично»
-- в /profile или в читалке клиент получал «permission denied for table
-- user_quotes».
--
-- Чиним: даём authenticated UPDATE свою строку (свою цитату), и никому
-- чужую. INSERT/DELETE уже были в мигр. 003.
-- ============================================================

DROP POLICY IF EXISTS user_quotes_self_update ON public.user_quotes;
CREATE POLICY user_quotes_self_update
  ON public.user_quotes FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT UPDATE ON public.user_quotes TO authenticated;
