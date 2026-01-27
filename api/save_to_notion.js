const { Client } = require('@notionhq/client');

// Initialize Notion client
const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

/**
 * Main serverless function handler
 * Handles progressive form autosave to Notion CRM
 * WITH: Duplicate prevention + Investment amount tracking + UTM parameters + AC prep
 */
module.exports = async (req, res) => {
  // Enable CORS for Webflow domain
  res.setHeader('Access-Control-Allow-Origin', '*');
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
    // Extract all fields from request body
    const { 
      first_name, 
      last_name, 
      phone_number, 
      email, 
      is_accredited, 
      investment_amount,
      entry_id,
      update_existing,
      // UTM parameters
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      // ActiveCampaign fields
      ac_sync_status,
      investor_state,
      funding_state,
      marketing_consent,
      tags
    } = req.body;

    // Only save if email OR phone is provided
    if (!email && !phone_number) {
      return res.status(400).json({
        error: 'Contact method required',
        message: 'Must provide email or phone number before saving'
      });
    }

    // Search for existing entry by email or phone (duplicate prevention)
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

    // Add investment amount if provided
    if (investment_amount) {
      properties['Investment Amount'] = {
        number: parseFloat(investment_amount)
      };
    }

    // Add UTM parameters
    if (utm_source) {
      properties['UTM Source'] = {
        rich_text: [{ text: { content: utm_source } }]
      };
    }

    if (utm_medium) {
      properties['UTM Medium'] = {
        rich_text: [{ text: { content: utm_medium } }]
      };
    }

    if (utm_campaign) {
      properties['UTM Campaign'] = {
        rich_text: [{ text: { content: utm_campaign } }]
      };
    }

    if (utm_content) {
      properties['UTM Content'] = {
        rich_text: [{ text: { content: utm_content } }]
      };
    }

    if (utm_term) {
      properties['UTM Term'] = {
        rich_text: [{ text: { content: utm_term } }]
      };
    }

    // Add ActiveCampaign integration fields
    if (ac_sync_status) {
      properties['AC Sync Status'] = {
        select: { name: ac_sync_status }
      };
    }

    if (investor_state) {
      properties['Investor State'] = {
        select: { name: investor_state }
      };
    }

    if (funding_state) {
      properties['Funding State'] = {
        select: { name: funding_state }
      };
    }

    if (marketing_consent !== undefined) {
      properties['Marketing Consent'] = {
        checkbox: marketing_consent
      };
    }

    if (tags && Array.isArray(tags) && tags.length > 0) {
      properties['Tags'] = {
        multi_select: tags.map(tag => ({ name: tag }))
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
        matched_by: matchedBy
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