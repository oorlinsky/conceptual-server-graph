const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000; // Backend runs on port 3000

// --- Configuration ---
const GRAPHDB_URL = 'http://localhost:7200'; // Your GraphDB instance URL
const REPOSITORY_ID = 'conceptual-repo';          // The repository you created
const GRAPHDB_SPARQL_ENDPOINT = `${GRAPHDB_URL}/repositories/${REPOSITORY_ID}/statements`;
const BASE_URI = 'http://conceptual-machines.org/'; // Base URI for your RDF data

// --- Middleware ---
app.use(cors()); // Enable Cross-Origin Resource Sharing for frontend requests
app.use(express.json()); // Enable parsing JSON request bodies

// Add this helper function to escape SPARQL strings properly
function escapeSparqlString(str) {
    if (!str) return str;
    return str
        .replace(/\\/g, '\\\\')  // Escape backslashes first
        .replace(/"/g, '\\"')    // Escape double quotes
        .replace(/\n/g, '\\n')   // Escape newlines
        .replace(/\r/g, '\\r')   // Escape carriage returns
        .replace(/\t/g, '\\t');  // Escape tabs
}

// --- API Routes ---

// POST /insert-term - Endpoint to insert a Term
app.post('/insert-term', async (req, res) => {
    const { label, comment, parentId } = req.body;

    // Basic validation
    if (!label) {
        return res.status(400).json({ error: 'Term label is required.' });
    }

    // Generate a unique ID for the term
    const termId = `Term_${Date.now()}`;
    const termUri = `${BASE_URI}${termId}`;

    // Escape the label and comment to handle special characters
    const escapedLabel = escapeSparqlString(label);
    const escapedComment = escapeSparqlString(comment);

    const sparqlUpdate = `
     PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
     INSERT DATA {
         <${termUri}> skos:prefLabel "${escapedLabel}" .
         ${escapedComment ? `<${termUri}> skos:note "${escapedComment}" .` : ''}
         ${parentId ? `<${parentId}> skos:narrower <${termUri}> .` : `<${BASE_URI}Root> skos:narrower <${termUri}> .`}
     }
    `;
    console.log('Sending SPARQL Update for Term:', sparqlUpdate);

    try {
        const response = await axios.post(
            GRAPHDB_SPARQL_ENDPOINT,
            sparqlUpdate,
            {
                headers: {
                    'Content-Type': 'application/sparql-update',
                    'Accept': 'application/json'
                }
            }
        );

        // GraphDB returns 204 No Content on successful update
        if (response.status === 204) {
            console.log('Term inserted successfully into GraphDB.');
            res.status(200).json({ 
                message: 'Term inserted successfully!',
                termId: termId
            });
        } else {
            console.warn('GraphDB returned unexpected status code:', response.status);
            res.status(response.status).json({ 
                message: 'Term might have been inserted, but received unexpected status.', 
                graphDbStatus: response.status 
            });
        }
    } catch (error) {
        console.error('Error inserting Term into GraphDB:', error.response ? error.response.data : error.message);
         
        // Provide more details if available from GraphDB response
        const statusCode = error.response ? error.response.status : 500;
        const errorMessage = error.response && error.response.data 
            ? error.response.data 
            : 'Failed to insert Term into GraphDB.';
        
        res.status(statusCode).json({ error: errorMessage });
    }
});


// GET endpoint to retrieve the graph data
app.get('/graph', async (req, res) => {
  try {
    // Updated SPARQL query in the /graph endpoint
    const query = `
     
      PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
      PREFIX cm: <${BASE_URI}>
      
      SELECT ?node ?label ?comment ?source ?relationshipType
      WHERE {

      
       # Get node labels
        OPTIONAL { ?node skos:prefLabel ?label } .
        
        # Get node comments if available
        OPTIONAL { ?node skos:note ?comment } .
        
        # Get connections between nodes with explicit relationship type
        OPTIONAL {
	        ?source skos:narrower ?node .
    	    BIND(skos:narrower AS ?relationshipType)
        }
        
        # Filter to include only nodes that are Terms or Roles or connected to conceptual-map
        FILTER(
          CONTAINS(STR(?nodeType), "Term") || 
          CONTAINS(STR(?nodeType), "Role") ||
          CONTAINS(STR(?node), "Root") ||
          EXISTS { cm:Root skos:narrower ?node }
        )
      }
    `;

    console.log('Sending SPARQL Query:', query);

    // Execute the SPARQL query with axios to match the style of the POST endpoint
    const response = await axios.get(
      `${GRAPHDB_URL}/repositories/${REPOSITORY_ID}`,
      {
        params: {
          query: query
        },
        headers: {
          'Accept': 'application/sparql-results+json'
        }
      }
    );

    if (response.status === 200) {
      console.log('Data fetched successfully from GraphDB.');
    console.log(`Number of records returned: ${response.data.results.bindings.length}`);
      
      // Process data server-side and return a cleaner structure
      const processedData = {
        nodes: [],
        edges: []
      };
      
      // Transform the data here before sending it
      response.data.results.bindings.forEach(binding => {
        processedData.nodes.push({
          id: binding.node.value,
          label: binding.label ? binding.label.value : '',
          comment: binding.comment ? binding.comment.value : ''
        });
        
        if (binding.source) {
          processedData.edges.push({
            source: binding.source.value,
            target: binding.node.value,
            type: binding.relationshipType ? binding.relationshipType.value : ''
          });
        }
      });
      
      res.status(200).json(processedData);
    } else {
      console.warn('GraphDB returned unexpected status code:', response.status);
      res.status(response.status).json({ 
        message: 'Data might have been fetched, but received unexpected status.', 
        graphDbStatus: response.status 
      });
    }
  } catch (error) {
    console.error('Error fetching graph data from GraphDB:', error.response ? error.response.data : error.message);
    
    // Provide more details if available from GraphDB response
    const statusCode = error.response ? error.response.status : 500;
    const errorMessage = error.response && error.response.data 
      ? error.response.data 
      : 'Failed to fetch data from GraphDB.';
    
    res.status(statusCode).json({ error: errorMessage });
  }
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Node.js server listening on port ${PORT}`);
    console.log(`GraphDB SPARQL Update Endpoint: ${GRAPHDB_SPARQL_ENDPOINT}`);
});