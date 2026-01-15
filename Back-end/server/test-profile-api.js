import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const BASE_URL =
  process.env.TEST_API_BASE_URL ||
  `http://localhost:${process.env.PORT || 5000}`;

const TEST_USER = {
  name: "Profile Test User",
  email: `profile_test_${Date.now()}@example.com`,
  password: "Password123!",
};

let accessToken = "";

async function registerUser() {
  try {
    const response = await axios.post(`${BASE_URL}/auth/register`, {
      name: TEST_USER.name,
      email: TEST_USER.email,
      password: TEST_USER.password,
    });
    accessToken = response.data.accessToken;
    console.log("Registered test user");
  } catch (error) {
    if (
      error.response &&
      error.response.status === 400 &&
      error.response.data &&
      error.response.data.message === "User with this email already exists"
    ) {
      console.log("Test user already exists, logging in");
      await loginUser();
      return;
    }
    throw error;
  }
}

async function loginUser() {
  const response = await axios.post(`${BASE_URL}/auth/login`, {
    email: TEST_USER.email,
    password: TEST_USER.password,
  });
  accessToken = response.data.accessToken;
  console.log("Logged in test user");
}

function authHeaders() {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

async function getProfile() {
  const response = await axios.get(`${BASE_URL}/profile`, {
    headers: authHeaders(),
  });
  return response.data;
}

async function updateProfile() {
  const payload = {
    name: "Updated Profile Test User",
    email: TEST_USER.email,
    addresses: [
      {
        fullName: "Updated Profile Test User",
        phone: "1234567890",
        addressLine1: "123 Test Street",
        addressLine2: "Suite 1",
        city: "Test City",
        state: "Test State",
        postalCode: "123456",
        country: "India",
        isDefault: true,
      },
    ],
  };

  const response = await axios.put(`${BASE_URL}/profile`, payload, {
    headers: authHeaders(),
  });
  return response.data;
}

async function run() {
  console.log("Profile API integration tests\n");

  try {
    await registerUser();

    if (!accessToken) {
      await loginUser();
    }

    const initialProfile = await getProfile();
    console.log("Initial profile:", JSON.stringify(initialProfile, null, 2));

    const updatedProfile = await updateProfile();
    console.log("Updated profile:", JSON.stringify(updatedProfile, null, 2));

    const finalProfile = await getProfile();
    console.log("Final profile:", JSON.stringify(finalProfile, null, 2));

    let passed = true;

    if (!initialProfile || initialProfile.success !== true) {
      passed = false;
    }

    if (!updatedProfile || updatedProfile.success !== true) {
      passed = false;
    }

    if (!finalProfile || finalProfile.success !== true) {
      passed = false;
    }

    const user =
      (updatedProfile && updatedProfile.user) ||
      (finalProfile && finalProfile.user);

    if (!user) {
      passed = false;
    } else {
      if (!Array.isArray(user.addresses) || user.addresses.length === 0) {
        passed = false;
      }
      const address = user.addresses[0];
      if (!address || address.city !== "Test City") {
        passed = false;
      }
    }

    if (passed) {
      console.log("\nProfile API integration tests passed");
      process.exit(0);
    } else {
      console.log("\nProfile API integration tests failed");
      process.exit(1);
    }
  } catch (error) {
    if (error.response) {
      console.error("Error status:", error.response.status);
      console.error("Error data:", JSON.stringify(error.response.data, null, 2));
    } else {
      console.error("Error:", error.message);
    }
    process.exit(1);
  }
}

run();

