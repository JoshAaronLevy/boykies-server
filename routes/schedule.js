const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// GET /api/schedule - Serves the entire schedule data from data/schedule/regularSeason.json
router.get('/', async (req, res) => {
  try {
    const filePath = path.join(__dirname, '..', 'data', 'schedule', 'regularSeason.json');
    const jsonData = fs.readFileSync(filePath, 'utf8');
    const schedule = JSON.parse(jsonData);
    
    res.json({
      ok: true,
      data: schedule
    });
  } catch (error) {
    console.error('[SCHEDULE] Error reading regularSeason.json:', error.message);
    res.status(500).json({
      ok: false,
      error: `Failed to read schedule data: ${error.message}`
    });
  }
});

// GET /api/schedule/:weekNumber - Serves schedule data for a specific week
router.get('/:weekNumber', async (req, res) => {
  try {
    const weekNumber = req.params.weekNumber;
    
    // Validate weekNumber is a positive integer
    if (!weekNumber || !Number.isInteger(Number(weekNumber)) || Number(weekNumber) < 1) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid week number. Must be a positive integer.'
      });
    }
    
    const filePath = path.join(__dirname, '..', 'data', 'schedule', 'regularSeason.json');
    const jsonData = fs.readFileSync(filePath, 'utf8');
    const schedule = JSON.parse(jsonData);
    
    const weekKey = `week${weekNumber}`;
    const weekData = schedule[weekKey];
    
    if (!weekData) {
      return res.status(404).json({
        ok: false,
        error: `Week ${weekNumber} not found in schedule data`
      });
    }
    
    res.json({
      ok: true,
      week: Number(weekNumber),
      data: weekData
    });
  } catch (error) {
    console.error(`[SCHEDULE] Error reading week ${req.params.weekNumber}:`, error.message);
    res.status(500).json({
      ok: false,
      error: `Failed to read schedule data: ${error.message}`
    });
  }
});

module.exports = router;