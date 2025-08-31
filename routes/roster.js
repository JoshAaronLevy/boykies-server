const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// GET /allPlayers - Serves the JSON data from data/roster/allPlayers.json
router.get('/allPlayers', async (req, res) => {
  try {
    const filePath = path.join(__dirname, '..', 'data', 'roster', 'allPlayers.json');
    const jsonData = fs.readFileSync(filePath, 'utf8');
    const players = JSON.parse(jsonData);
    
    res.json({
      ok: true,
      data: players
    });
  } catch (error) {
    console.error('[ROSTER] Error reading allPlayers.json:', error.message);
    res.status(500).json({
      ok: false,
      error: `Failed to read roster data: ${error.message}`
    });
  }
});

module.exports = router;