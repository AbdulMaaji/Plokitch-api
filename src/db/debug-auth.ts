import "dotenv/config";
import { auth } from "../lib/auth.js";

async function debugSignIn() {
  const url = "http://localhost:4000/api/auth/sign-in/email";
  
  // MOCK A REQUEST
  const req = new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "test@example.com",
      password: "password123",
    }),
  });

  console.log("🚀 Testing auth.handler with mock request...");
  
  try {
    const response = await auth.handler(req);
    console.log("Status:", response.status);
    const body = await response.text();
    console.log("Body:", body);
  } catch (error) {
    console.error("🔥 CRASH DETECTED:", error);
  } finally {
    process.exit(0);
  }
}

debugSignIn();
