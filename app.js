const express = require('express');
const axios = require("axios");
const cors = require('cors');
const path = require('path');

const {open} = require('sqlite');
const sqlite3 = require('sqlite3');
const { request } = require('http');

const app = express();
app.use(cors());
app.use(express.json());

const dbPath = path.join(__dirname, 'roxiler.db');

let db = null;

const initializeServer = async () => {
    try {
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database,
        });
        app.listen(3000, () => {
            console.log('Server Running at http://localhost:3000/');
        });
    } catch (e) {
        console.log(`DB Error: ${e.message}`);
        process.exit(1);
    }
};

initializeServer();

const fetchAndInsert = async () => {
    const response = await axios.get(
      "https://s3.amazonaws.com/roxiler.com/product_transaction.json"
    );
    const data = response.data;
  
    for (let item of data) {
      const queryData = `SELECT id FROM transactions WHERE id = ${item.id}`;
      const existingData = await db.get(queryData);
      if (existingData === undefined) {
        const query = `
     INSERT INTO transactions (id, title, price, description, category, image, sold, date_of_sale) 
     VALUES (
         ${item.id},
         '${item.title.replace(/'/g, "''")}',
         ${item.price},
         '${item.description.replace(/'/g, "''")}',
         '${item.category.replace(/'/g, "''")}',
         '${item.image.replace(/'/g, "''")}',
         ${item.sold},
         '${item.dateOfSale.replace(/'/g, "''")}'
     );
  `; 
  
        await db.run(query);
      }
    }
    console.log("Transactions added");
  };
  
  fetchAndInsert();

  const convertALlTrans = (dbObject) => {
    return {
      id: dbObject.id,
      title: dbObject.title,
      price: dbObject.price,
      description: dbObject.description,
      category: dbObject.category,
      image: dbObject.image,
      sold: dbObject.sold,
      dateOfSale: dbObject.date_of_sale,
    }
  }

// API to list the all transactions
app.get('/transactions', async (request, response) => {
  const getAllTransQuery = `
    SELECT *
    FROM transactions;
  `;
  const transacArray = await db.all(getAllTransQuery);
  response.send(transacArray.map((each) => convertALlTrans(each))); 
})  

// API to post
app.post('/transactions/', async (request, response) => {
  const transactionsDetails = request.body;
  const {
    title,
    price,
    description,
    category,
    image,
    sold,
    dateOfSale, 
  } = transactionsDetails;
  const addTransactionQuery = `
    INSERT INTO transaction (
      title,
      price,
      description,
      category,
      image,
      sold,
      date_of_sale)
    VALUES (
      '${title}',
      ${price},
      '${description}',
      '${category}',
      '${image}',
      ${sold},
      '${dateOfSale}'
    );
  `;
  const dbResponse = await db.run(addTransactionQuery);
  const transacId = dbResponse.lastID;
  response.send('Transaction Successfully Added');
})

// 1. Create an API to list the all transactions
app.get('/transactions/', async (request, response) => {
  const page = parseInt(request.query.page) || 1;
  const perPage = parseInt(request,express.query.perPage) || 10;
  const searchText = request.query.search || '';

  const offset = (page - 1) * perPage;

  const getReqSearchQuery = `
    SELECT * 
    FROM transactions
    WHERE title LIKE '%${searchText}%' OR description LIKE '%${searchText}%' OR price LIKE '%${searchText}%';
  `;
  const result = await db.all(getReqSearchQuery);
  response.send(result);
})

// 2. Create an API for statistics

app.get('/transactions/stats', async (request, response) => {
  const selectedMonth = request.query.month;
    if (!selectedMonth) {
        res.status(400).json({ error: "Month parameter is required" });
        return;
    }

    const saleAmountRowQuery = `
      SELECT SUM(price) AS totalSaleAmount 
      FROM transactions 
      WHERE CAST(strftime('%m', date_of_sale) AS INTEGER) = ${selectedMonth};
    `;
    
    const saleAmountRow = await db.get(saleAmountRowQuery);

    const soldItemsRowQuery = `
      SELECT COUNT(*) AS totalSoldItems 
      FROM transactions 
      WHERE CAST(strftime('%m', date_of_sale) AS INTEGER) = ${selectedMonth};
    `;

    const soldItemsRow = await db.get(soldItemsRowQuery);

    const notSoldItemsRowQuery = `
      SELECT COUNT(*) AS totalNotSoldItems 
      FROM transactions 
      WHERE CAST(strftime('%m', date_of_sale) AS INTEGER) = ${selectedMonth} AND sold = 0;
    `;

    const notSoldItemsRow = await db.get(notSoldItemsRowQuery);

    const statistics = {
      totalSaleAmount: saleAmountRow.totalSaleAmount || 0,
      totalSoldItems: soldItemsRow.totalSoldItems || 0,
      totalNotSoldItems: notSoldItemsRow.totalNotSoldItems || 0
  };

  response.send(statistics);
}) 

// 3. Create an API for bar chart ( the response should contain price range and the number of items in that range for the selected month regardless of the year )

app.get('/bar-chart', async (request, response) => {
  const selectedMonth = request.query.month;
  if (!selectedMonth) {
      res.status(400).json({ error: "Month parameter is required" });
      return;
  }

  const priceRanges = [
      { min: 0, max: 100 },
      { min: 101, max: 200 },
      { min: 201, max: 300 },
      { min: 301, max: 400 },
      { min: 401, max: 500 },
      { min: 501, max: 600 },
      { min: 601, max: 700 },
      { min: 701, max: 800 },
      { min: 801, max: 900 },
      { min: 901, max: Infinity }
  ];

  const priceRangeCounts = {};
  priceRanges.forEach(range => {
      priceRangeCounts[`${range.min}-${range.max === Infinity ? 'above' : range.max}`] = 0;
  });

  const getBarchartQuery = `
    SELECT price 
    FROM transactions 
    WHERE CAST(strftime('%m', date_of_sale) AS INTEGER) = ${selectedMonth};
  `;

  const barchartData = await db.all(getBarchartQuery);

  barchartData.forEach(row => {
    const price = parseFloat(row.price);
    for (const range of priceRanges) {
        if (price >= range.min && price <= range.max) {
            priceRangeCounts[`${range.min}-${range.max === Infinity ? 'above' : range.max}`]++;
            break;
        }
    }
});

const result = Object.keys(priceRangeCounts).map(range => ({
    range,
    count: priceRangeCounts[range]
}));

response.send(result);
})


// 4. Create an API for pie chart Find unique categories and number of items from that category for the selected month regardless of the year.

app.get('/pie-chart', async (request, response) => {
  const selectedMonth = request.query.month;

  const getPieChartQuery = `
    SELECT category, COUNT(*) AS itemCount 
    FROM transactions 
    WHERE CAST(strftime('%m', date_of_sale) AS INTEGER) = ${selectedMonth} 
    GROUP BY category;
  `;
  const rows = await db.all(getPieChartQuery);
  //response.send(rows);
  const pieChartData = rows.map(row => ({
    category: row.category,
    itemCount: row.itemCount
  }));
  response.send(pieChartData);
})

// 5. Create an API which fetches the data from all the 3 APIs mentioned above, combines the response and sends a final response of the combined JSON

app.get('/combined-data', async (req, res) => {
  try {
      
      const apiUrl1 = 'http://localhost:3000/transactions';
      const apiUrl2 = 'http://localhost:3000/transactions/stats?month=01';
      const apiUrl3 = 'http://localhost:3000/bar-chart?month=02';
      const apiUrl4 = 'http://localhost:3000/pie-chart?month=03';

      
      const [transactionsResponse, statisticsResponse, barChartDataResponse, pieChartDataResponse] = await Promise.all([
          axios.get(apiUrl1),
          axios.get(apiUrl2),
          axios.get(apiUrl3),
          axios.get(apiUrl4)
      ]);


      const transactionsData = transactionsResponse.data;
      const statisticsData = statisticsResponse.data;
      const barChartData = barChartDataResponse.data;
      const pieChartData = pieChartDataResponse.data;

      const combinedData = {
          transactions: transactionsData,
          statistics: statisticsData,
          barChart: barChartData,
          pieChart: pieChartData
      };

      
      res.json(combinedData);
  } catch (error) {
      
      res.status(500).json({ error: error.message });
  }
});
