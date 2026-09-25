import fetch from "node-fetch";
import loginData from "../login.json";

async function run() {
  const token = loginData.token;
  const res = await fetch("http://localhost:5000/api/services/my", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const body = await res.json();
  console.log("=== API RESPONSE STATUS ===", res.status);
  console.log("=== API RESPONSE BODY ===", JSON.stringify(body, null, 2));
}

run().catch(console.error);
