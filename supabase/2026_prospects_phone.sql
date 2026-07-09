-- Store the business phone number on prospects. Google Places already returns
-- it (nationalPhoneNumber); the lead-finder now saves it alongside the website
-- so the owner can see phone + site when listing leads (e.g. in Telegram).

alter table prospects add column if not exists phone text;
