const { Client } = require('@notionhq/client');

// Initialize Notion client
const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

/**
 * Main serverless function handler
 * Handles progressive form autosave to Notion CRM
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
    const { first_name, last_name, phone_number, email, entry_id } = req.body;

    // CRITICAL: Only save if email OR phone is provided
    if (!email && !phone_number) {
      return res.status(400).json({
        error: 'Contact method required',
        message: 'Must provide email or phone number before saving'
      });
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

    // Add Group field (keeping it consistent with your database)
    // You can customize this based on your needs
    properties['Group'] = {
      select: {
        name: 'ECF'
      }
    };

    // If entry_id exists, UPDATE existing entry. Otherwise, CREATE new entry.
    if (entry_id) {
      // Update existing Notion page
      const response = await notion.pages.update({
        page_id: entry_id,
        properties: properties
      });

      return res.status(200).json({
        success: true,
        message: 'Entry updated successfully',
        entry_id: response.id,
        action: 'updated'
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

// test again