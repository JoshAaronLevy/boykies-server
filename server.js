require("dotenv").config();
const express = require("express");
const { neon } = require("@neondatabase/serverless");

const sql = neon(process.env.DATABASE_URL);
const app = express();
app.use(express.json());

// Endpoint to check connection and version
app.get("/version", async (req, res) => {
  try {
    const result = await sql`SELECT version()`;
    res.json(result[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to insert a player
app.post("/players", async (req, res) => {
  // Destructure the request body to individual variables
  const {
    id,
    overallRank,
    position,
    positionRank,
    name,
    teamAbbr,
    byeWeek,
    yearsPro,
    newTeam,
    role,
    competitionLevel,
    attributes,
    riskScore,
    stats
  } = req.body;

  try {
    await sql`
      INSERT INTO draft_roster (
        id, overall_rank, position, position_rank, name, team_abbr, bye_week,
        years_pro, new_team, role, competition_level, attributes, risk_score, stats
      ) VALUES (
        ${id},
        ${overallRank},
        ${position},
        ${positionRank},
        ${name},
        ${teamAbbr},
        ${byeWeek},
        ${yearsPro},
        ${newTeam},
        ${role},
        ${competitionLevel},
        ${JSON.stringify(attributes)},
        ${riskScore},
        ${JSON.stringify(stats)}
      )
    `;
    res.json({ success: true, inserted: id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Optional: Endpoint to view all players for verification/testing
app.get("/players", async (req, res) => {
  try {
    const result = await sql`SELECT * FROM draft_roster`;
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
