import pkg from "pg";
const { Pool } = pkg;
import dotenv from "dotenv"; // Updated to use import

dotenv.config(); // Use dotenv to load environment variables

// PostgreSQL connection pool
const poolConfig = {
  connectionString: process.env.NEON_POSTGRES,
  ssl: {
    rejectUnauthorized: true,
  },
};

export const pool = new Pool(poolConfig);

// Test connection
(async () => {
  try {
    const client = await pool.connect();
    console.log("Connected to PostgreSQL database!");
    client.release();
  } catch (err) {
    console.error("Database connection error:", err);
  }
})(); 