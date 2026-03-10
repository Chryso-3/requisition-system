import { db } from "./src/firebase/index.js";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";
import { COLLECTIONS } from "./src/firebase/collections.js";

async function debugData() {
  console.log("--- USER DEBUG ---");
  const userQuery = query(
    collection(db, COLLECTIONS.USERS),
    where("email", "==", "12@gmail.com"),
  );
  const userSnap = await getDocs(userQuery);
  userSnap.forEach((d) => {
    console.log("User ID:", d.id);
    console.log("User Data:", JSON.stringify(d.data(), null, 2));
  });

  console.log("\n--- REQUISITION DEBUG ---");
  const reqQuery = query(
    collection(db, COLLECTIONS.REQUISITIONS),
    where("rfControlNo", "==", "RF-2026-000043"),
  );
  const reqSnap = await getDocs(reqQuery);
  reqSnap.forEach((d) => {
    console.log("Req ID:", d.id);
    console.log("Req Data:", JSON.stringify(d.data(), null, 2));
  });
}

debugData().catch(console.error);
