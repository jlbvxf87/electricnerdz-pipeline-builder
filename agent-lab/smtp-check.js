// One-shot Zoho SMTP connectivity + send test.
// Confirms your app password / host / port are correct by sending a single
// email to yourself. Run locally:
//
//   1. Copy .env.example -> .env.local and fill in the 4 ZOHO_SMTP_* values
//      (the same ones you added to Vercel).
//   2. npm install        (pulls nodemailer)
//   3. npm run smtp:check
//
// It only ever emails YOU (ZOHO_SMTP_USER). Nothing else is contacted.

const { createZohoSmtpSender } = require("./packages/agent-core");

(async () => {
  const user = process.env.ZOHO_SMTP_USER;
  const pass = (process.env.ZOHO_SMTP_PASS || "").replace(/\s+/g, ""); // strip any spaces
  const host = process.env.ZOHO_SMTP_HOST || "smtp.zoho.com";
  const port = process.env.ZOHO_SMTP_PORT || "465";

  if (!user || !pass) {
    console.error(
      "Missing ZOHO_SMTP_USER / ZOHO_SMTP_PASS.\n" +
        "Create agent-lab/.env.local from .env.example with your real values."
    );
    process.exit(1);
  }

  console.log(`Connecting to ${host}:${port} as ${user} ...`);

  try {
    const sender = createZohoSmtpSender({ user, pass, host, port: Number(port) });
    const result = await sender.send({
      from: user,
      to: user,
      subject: "Electric Nerdz — SMTP test OK",
      text:
        "If you're reading this in your inbox, your Zoho SMTP sender works and " +
        "the Pipeline Builder can send through it.\n\nhttps://electricnerdz.biz",
    });
    console.log("SENT ✓", result);
    console.log("Now check the inbox for:", user);
  } catch (err) {
    console.error("\nSMTP send FAILED:", err.message);
    console.error(
      "\nCommon fixes: enable IMAP/SMTP access in Zoho Mail settings, " +
        "use an app-specific password (not your login password), and remove any spaces from it."
    );
    process.exit(1);
  }
})();
