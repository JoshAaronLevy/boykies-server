require("dotenv").config();
const express = require("express");
const { neon } = require("@neondatabase/serverless");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const sql = neon(process.env.DATABASE_URL);
const app = express();
app.use(express.json());

// Dify API configuration
const DIFY_API_URL = "https://api.dify.ai/v1/chat-messages";
const DIFY_SECRET_KEY = process.env.DIFY_SECRET_KEY;
const DIFY_APP_ID = process.env.DIFY_APP_ID;

// Function to send message to Dify
async function sendToDify(message, conversationId = null, isUserTurn = false) {
  try {
    const payload = {
      inputs: {},
      query: message,
      response_mode: "blocking",
      conversation_id: conversationId,
      user: "fantasy-draft-user"
    };

    const config = {
      method: 'POST',
      url: DIFY_API_URL,
      headers: {
        'Authorization': `Bearer ${DIFY_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      data: payload,
      timeout: isUserTurn ? 120000 : 30000 // 2 minutes for user turn, 30 seconds for other operations
    };

    const response = await axios(config);
    return {
      success: true,
      data: response.data,
      conversationId: response.data.conversation_id
    };
  } catch (error) {
    console.error('Dify API Error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}

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

// Endpoint to serve players from finalized draft roster JSON file
app.get("/players", async (req, res) => {
  try {
    const filePath = path.join(__dirname, "data", "finalized", "draftRoster_v3.json");
    const jsonData = fs.readFileSync(filePath, "utf8");
    const players = JSON.parse(jsonData);
    res.json(players);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fantasy Football Draft Endpoints

// Endpoint to reset the draft
app.post("/draft/reset", async (req, res) => {
  try {
    const { message = "Draft reset - starting over." } = req.body;

    // Send reset message without conversation ID to start fresh
    const result = await sendToDify(message);
    
    if (result.success) {
      res.json({
        success: true,
        message: "Draft reset successfully. Ready for new initialization.",
        resetConfirmation: result.data.answer
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to initialize draft strategy
app.post("/draft/initialize", async (req, res) => {
  try {
    const { numTeams, userPickPosition, players } = req.body;
    
    if (!numTeams || !userPickPosition || !players) {
      return res.status(400).json({
        error: "Missing required fields: numTeams, userPickPosition, players"
      });
    }

    const message = `Fantasy football draft is beginning. League details:
- Number of teams: ${numTeams}
- My draft position: ${userPickPosition}
- Available players: ${JSON.stringify(players)}

Please create an in-depth draft strategy for this league setup.`;

    const result = await sendToDify(message);
    
    if (result.success) {
      res.json({
        success: true,
        strategy: result.data.answer,
        conversationId: result.conversationId
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to mark a player as taken
app.post("/draft/player-taken", async (req, res) => {
  try {
    const { player, round, pick, conversationId } = req.body;
    
    if (!player || !round || !pick || !conversationId) {
      return res.status(400).json({
        error: "Missing required fields: player, round, pick, conversationId"
      });
    }

    const message = `Player taken: ${JSON.stringify(player)} in round ${round}, pick ${pick}.`;

    const result = await sendToDify(message, conversationId);
    
    if (result.success) {
      res.json({
        success: true,
        confirmation: result.data.answer,
        conversationId: result.conversationId
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint for when it's the user's turn
app.post("/draft/user-turn", async (req, res) => {
  try {
    const { player, round, pick, userRoster, availablePlayers, conversationId } = req.body;
    
    if (!player || !round || !pick || !userRoster || !availablePlayers || !conversationId) {
      return res.status(400).json({
        error: "Missing required fields: player, round, pick, userRoster, availablePlayers, conversationId"
      });
    }

    const message = `Player taken: ${JSON.stringify(player)} in round ${round}, pick ${pick}.

IT'S MY TURN NOW!

My current roster: ${JSON.stringify(userRoster)}
Available players (top options): ${JSON.stringify(availablePlayers)}

Please provide your analysis and recommendations for my next pick.`;

    const result = await sendToDify(message, conversationId, true); // true for isUserTurn (longer timeout)
    
    if (result.success) {
      res.json({
        success: true,
        analysis: result.data.answer,
        conversationId: result.conversationId
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
