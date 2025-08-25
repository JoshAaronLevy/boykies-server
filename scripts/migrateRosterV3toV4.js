const fs = require('fs');
const path = require('path');

/**
 * Extract only specified keys from an object
 * @param {Object} obj - Source object
 * @param {Array} keys - Array of keys to extract
 * @returns {Object} - New object with only specified keys
 */
function pick(obj, keys) {
  const result = {};
  for (const key of keys) {
    if (obj.hasOwnProperty(key)) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Remove rushing/receiving/passing sub-objects based on zero attempt rules
 * @param {Object} predicted - The predicted stats object
 * @returns {Object} - Pruned predicted stats object
 */
function pruneZeros(predicted) {
  if (!predicted || typeof predicted !== 'object') {
    return predicted;
  }

  const result = { ...predicted };

  // Remove rushing if attempts === 0
  if (result.rushing && result.rushing.attempts === 0) {
    delete result.rushing;
  }

  // Remove receiving if targets === 0
  if (result.receiving && result.receiving.targets === 0) {
    delete result.receiving;
  }

  // Remove passing if attempts === 0
  if (result.passing && result.passing.attempts === 0) {
    delete result.passing;
  }

  return result;
}

/**
 * Remove empty nested containers after pruning
 * @param {Object} obj - Object to clean up
 * @returns {Object} - Object with empty containers removed
 */
function dropEmpty(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }

  const result = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const cleaned = dropEmpty(value);
      // Only keep object if it has properties
      if (Object.keys(cleaned).length > 0) {
        result[key] = cleaned;
      }
    } else if (value !== null && value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Transform a single player from v3 to v4 format
 * @param {Object} player - v3 player object
 * @returns {Object} - v4 player object
 */
function transformPlayer(player) {
  // Define allowed top-level fields
  const allowedFields = [
    'id', 'name', 'position', 'team', 'newOverallRank', 'previousOverallRank',
    'newPositionRank', 'previousPositionRank', 'expectedRound', 'reason',
    'yearsPro', 'newTeam', 'competitionLevel', 'byeWeek'
  ];

  // Start with allowed top-level fields
  let result = pick(player, allowedFields);

  // Handle team object - keep only abbr and logoUrl
  if (player.team) {
    result.team = pick(player.team, ['abbr', 'logoUrl']);
  }

  // Handle stats transformation
  if (player.stats && player.stats['2025'] && player.stats['2025'].predicted) {
    const predicted = player.stats['2025'].predicted;
    
    // Prune zero stats
    const prunedPredicted = pruneZeros(predicted);
    
    // Only include stats if we still have something after pruning
    if (Object.keys(prunedPredicted).length > 0) {
      result.stats = {
        '2025': {
          predicted: prunedPredicted
        }
      };
    }
  }

  // Remove null/undefined properties except for ranks and specific fields that may legitimately be null
  const preserveNullFields = [
    'newOverallRank', 'previousOverallRank', 'newPositionRank', 'previousPositionRank',
    'expectedRound', 'yearsPro', 'competitionLevel', 'byeWeek'
  ];

  const cleanResult = {};
  for (const [key, value] of Object.entries(result)) {
    if (value === null || value === undefined) {
      // Keep null/undefined for specific fields
      if (preserveNullFields.includes(key)) {
        cleanResult[key] = value;
      }
    } else {
      cleanResult[key] = value;
    }
  }

  // Final cleanup of empty containers
  return dropEmpty(cleanResult);
}

/**
 * Calculate file size in KB
 * @param {string} filePath - Path to file
 * @returns {number} - Size in KB
 */
function getFileSizeKB(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size / 1024;
  } catch (error) {
    return 0;
  }
}

/**
 * Calculate object size in bytes (approximate)
 * @param {Object} obj - Object to measure
 * @returns {number} - Size in bytes
 */
function getObjectSize(obj) {
  return Buffer.byteLength(JSON.stringify(obj), 'utf8');
}

/**
 * Main migration function
 */
function migrateRosterV3toV4() {
  const inputPath = path.join(__dirname, '..', 'data', 'finalized', 'draftRoster_v3.json');
  const outputPath = path.join(__dirname, '..', 'data', 'finalized', 'draftRoster_v4.json');

  // Read and validate input file
  let v3Data;
  try {
    const rawData = fs.readFileSync(inputPath, 'utf8');
    v3Data = JSON.parse(rawData);
  } catch (error) {
    console.error(`Error reading input file: ${error.message}`);
    process.exit(1);
  }

  // Validate it's an array
  if (!Array.isArray(v3Data)) {
    console.error('Error: Input data is not an array');
    process.exit(1);
  }

  // Calculate input metrics
  const inputSizeKB = getFileSizeKB(inputPath);
  const playerCount = v3Data.length;
  
  let totalInputSize = 0;
  let totalOutputSize = 0;
  let warningCount = 0;

  // Transform each player (preserving exact array order)
  const v4Data = v3Data.map((player, index) => {
    // Calculate input size
    const inputSize = getObjectSize(player);
    totalInputSize += inputSize;

    // Validate required fields
    const requiredFields = ['id', 'name', 'position'];
    const missingFields = requiredFields.filter(field => !player[field]);
    const missingTeamAbbr = !player.team || !player.team.abbr;

    if (missingFields.length > 0 || missingTeamAbbr) {
      console.warn(`WARN: Player at index ${index} missing required fields: ${[...missingFields, ...(missingTeamAbbr ? ['team.abbr'] : [])].join(', ')}`);
      warningCount++;
    }

    // Transform player
    const transformedPlayer = transformPlayer(player);
    
    // Calculate output size
    const outputSize = getObjectSize(transformedPlayer);
    totalOutputSize += outputSize;

    return transformedPlayer;
  });

  // Write output file with pretty printing
  try {
    fs.writeFileSync(outputPath, JSON.stringify(v4Data, null, 2), 'utf8');
  } catch (error) {
    console.error(`Error writing output file: ${error.message}`);
    process.exit(1);
  }

  // Calculate output metrics
  const outputSizeKB = getFileSizeKB(outputPath);
  const avgInputSizeKB = (totalInputSize / 1024) / playerCount;
  const avgOutputSizeKB = (totalOutputSize / 1024) / playerCount;

  // Log summary
  console.log(`migrate: players=${playerCount}, in=${inputSizeKB.toFixed(1)}KB, out=${outputSizeKB.toFixed(1)}KB, avgBefore=${avgInputSizeKB.toFixed(1)}KB, avgAfter=${avgOutputSizeKB.toFixed(1)}KB`);
  
  if (warningCount > 0) {
    console.log(`Migration completed with ${warningCount} warnings.`);
  } else {
    console.log('Migration completed successfully with no warnings.');
  }
}

// Run migration if this script is executed directly
if (require.main === module) {
  migrateRosterV3toV4();
}

module.exports = {
  pick,
  pruneZeros,
  dropEmpty,
  transformPlayer,
  migrateRosterV3toV4
};