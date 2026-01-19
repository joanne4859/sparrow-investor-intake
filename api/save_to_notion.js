const { Client } = require('@notionhq/client');

// Initialize Notion client
const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

/**
 * Main serverless function handler
 * Handles progressive form autosave to Notion CRM
 * NOW WITH: Duplicate prevention + Investment amount tracking
 */
module.exports = async (req, res) => {
  // Enable CORS for Webflow domain
  res.setHeader('Access-Control-Allow-Origin', '*'); // Change to your Webflow domain in production
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    // NEW: Extract investment_amount and update_existing from request body
    const { 
      first_name, 
      last_name, 
      phone_number, 
      email, 
      is_accredited, 
      investment_amount,  // NEW: Investment amount from calculator
      entry_id,
      update_existing     // NEW: Flag to enable duplicate prevention
    } = req.body;

    // CRITICAL: Only save if email OR phone is provided
    if (!email && !phone_number) {
      return res.status(400).json({
        error: 'Contact method required',
        message: 'Must provide email or phone number before saving'
      });
    }

    // NEW: Search for existing entry by email or phone (duplicate prevention)
    let existingEntry = null;
    let matchedBy = null;
    
    if (update_existing && !entry_id) {
      try {
        const filters = [];
        
        if (email) {
          filters.push({
            property: "Email",
            email: { equals: email }
          });
        }
        
        if (phone_number) {
          filters.push({
            property: "Phone",
            phone_number: { equals: phone_number }
          });
        }
        
        const searchResults = await notion.databases.query({
          database_id: DATABASE_ID,
          filter: filters.length > 1 
            ? { or: filters } 
            : filters[0]
        });
        
        if (searchResults.results.length > 0) {
          existingEntry = searchResults.results[0];
          
          // Determine which field matched
          const props = existingEntry.properties;
          if (props.Email?.email === email) {
            matchedBy = 'email';
          } else if (props.Phone?.phone_number === phone_number) {
            matchedBy = 'phone';
          }
          
          console.log(`Found existing entry (matched by ${matchedBy}):`, existingEntry.id);
        }
      } catch (error) {
        console.error('Error searching for existing entry:', error);
        // Continue with creation if search fails
      }
    }

    // Prepare properties for Notion database
    const properties = {
      Name: {
        title: [
          {
            text: {
              content: `${first_name || ''} ${last_name || ''}`.trim() || 'No name provided'
            }
          }
        ]
      }
    };

    // Add email if provided
    if (email) {
      properties['Email'] = {
        email: email
      };
    }

    // Add phone if provided
    if (phone_number) {
      properties['Phone'] = {
        phone_number: phone_number
      };
    }

    // NEW: Add investment amount if provided
    if (investment_amount) {
      properties['Investment Amount'] = {
        number: parseFloat(investment_amount)
      };
    }

    // Add timestamps for tracking
    const now = new Date().toISOString();
    
    // Determine which entry ID to use (existing match or provided entry_id)
    const targetEntryId = existingEntry?.id || entry_id;
    
    // If this is a new entry, set Created At timestamp
    if (!targetEntryId) {
      properties['Created At'] = {
        date: {
          start: now
        }
      };
    }
    
    // Always update Last Updated timestamp
    properties['Last Updated'] = {
      date: {
        start: now
      }
    };

    // Add Group relation - automatically assigns to "ECF - DM" group
    properties['Group'] = {
      relation: [
        {
          id: '2e110ef8d70d80aa872fc31246ca1f85'
        }
      ]
    };

    // Add Accredited Investor status if provided
    if (is_accredited !== undefined) {
      properties['Accredited Investor'] = {
        checkbox: is_accredited
      };
    }

    // If targetEntryId exists, UPDATE existing entry. Otherwise, CREATE new entry.
    if (targetEntryId) {
      // Update existing Notion page
      const response = await notion.pages.update({
        page_id: targetEntryId,
        properties: properties
      });

      return res.status(200).json({
        success: true,
        message: 'Entry updated successfully',
        entry_id: response.id,
        action: 'updated',
        matched_by: matchedBy  // NEW: Tell frontend which field matched
      });
    } else {
      // Create new Notion page
      const response = await notion.pages.create({
        parent: {
          database_id: DATABASE_ID
        },
        properties: properties
      });

      return res.status(200).json({
        success: true,
        message: 'New entry created successfully',
        entry_id: response.id,
        action: 'created'
      });
    }

  } catch (error) {
    console.error('Error saving to Notion:', error);
    
    return res.status(500).json({
      error: 'Failed to save to Notion',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error : undefined
    });
  }
};