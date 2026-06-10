const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false 
  }
});

// BASE ROUTE
app.get('/', (req, res) => {
  try {
    res.json({ message: "WELCOME ! " });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================================
// 👤 USER AUTHENTICATION APIS
// ========================================================

// 1. USER SIGNUP API
app.post('/api/user/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Plz Fill Complete form !" });
  }

  try {
    const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: "This Email is Already Registered " });
    }

    const newUser = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name, email, password]
    );

    res.status(201).json({ message: "Signup Successful!", user: newUser.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. USER LOGIN API
app.post('/api/user/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Plz Insert Email ANd Password Both " });
  }

  try {
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0 || user.rows[0].password !== password) {
      return res.status(400).json({ error: "Incorrect Email oR Pasword" });
    }

    res.json({ message: "Login Successful!", user: { id: user.rows[0].id, name: user.rows[0].name, email: user.rows[0].email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================================
// 💰 TRANSACTIONS APIS (Using Exp_transactions)
// ========================================================

// 1. ADD PRIMARY INCOME API (Mahine mein ek baar ke liye)
app.post('/api/transactions/primary-income', async (req, res) => {
  const { user_id, amount } = req.body;

  if (!user_id || !amount) {
    return res.status(400).json({ error: "UserId aur Amount zaroori hain!" });
  }

  try {
    // Exp_transactions table mein check karna ke is month primary income hai ya nahi
    const checkIncome = await pool.query(
      `SELECT * FROM Exp_transactions 
       WHERE user_id = $1 AND category = 'Primary Income' 
       AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM CURRENT_DATE)
       AND EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM CURRENT_DATE)`,
      [user_id]
    );

    if (checkIncome.rows.length > 0) {
      return res.status(400).json({ error: "Aap is mahine ki Primary Income pehle hi add kar chuke hain!" });
    }

    // Type ko 'INFLOW' uppercase rakha hai consistency ke liye
    const newTransaction = await pool.query(
      `INSERT INTO Exp_transactions (user_id, title, category, amount, type) 
       VALUES ($1, 'Monthly Salary', 'Primary Income', $2, 'INFLOW') 
       RETURNING *`,
      [user_id, amount]
    );

    res.status(201).json({ message: "Primary Income added successfully!", transaction: newTransaction.rows[0] });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. ADD SECONDARY INCOME API
app.post('/api/transactions/secondary-income', async (req, res) => {
  const { user_id, title, amount } = req.body;

  if (!user_id || !title || !amount) {
    return res.status(400).json({ error: "Saare fields (User ID, Title, Amount) bharna zaroori hain!" });
  }

  try {
    const newTransaction = await pool.query(
      `INSERT INTO Exp_transactions (user_id, title, category, amount, type) 
       VALUES ($1, $2, 'Secondary Income', $3, 'INFLOW') 
       RETURNING *`,
      [user_id, title, amount]
    );

    res.status(201).json({ message: "Secondary Income added successfully!", transaction: newTransaction.rows[0] });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. ADD EXPENSE (OUTFLOW) TRANSACTION API
app.post('/api/transactions/expense', async (req, res) => {
  const { user_id, title, category, amount } = req.body;

  if (!user_id || !title || !category || !amount) {
    return res.status(400).json({ error: "Saare fields bharna zaroori hain!" });
  }

  try {
    const newExpense = await pool.query(
      `INSERT INTO Exp_transactions (user_id, title, amount, category, type) 
       VALUES ($1, $2, $3, $4, 'OUTFLOW') RETURNING *`,
      [user_id, title, amount, category]
    );
    res.status(201).json({ message: "Kharcha successfully record ho gaya!", transaction: newExpense.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. GET USER TRANSACTIONS & TOTALS (Main Dashboard Calculator)
app.get('/api/transactions/:user_id', async (req, res) => {
  const { user_id } = req.params;

  try {
    const allTransactions = await pool.query(
      'SELECT * FROM Exp_transactions WHERE user_id = $1 ORDER BY date DESC', 
      [user_id]
    );

    let totalIncome = 0;
    let totalExpenses = 0;

    // Loop chala kar dynamic calculations (Casing-insensitive match ke liye UPPERCASE use kiya)
    allTransactions.rows.forEach(tx => {
      const amt = parseFloat(tx.amount);
      if (tx.type.toUpperCase() === 'INFLOW') {
        totalIncome += amt;
      } else if (tx.type.toUpperCase() === 'OUTFLOW') {
        totalExpenses += amt;
      }
    });

    const availableBalance = totalIncome - totalExpenses;

    res.json({
      transactions: allTransactions.rows,
      totalIncome: totalIncome.toFixed(2),
      totalExpenses: totalExpenses.toFixed(2),
      availableBalance: availableBalance.toFixed(2)
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================================
// 📁 EXPENSE CATEGORIES APIS
// ========================================================

// 1. ADD EXPENSE CATEGORY API
app.post('/api/categories', async (req, res) => {
  const { user_id, category_name } = req.body;

  if (!user_id || !category_name) {
    return res.status(400).json({ error: "User ID aur Category Name dono zaroori hain!" });
  }

  try {
    const categoryExists = await pool.query(
      'SELECT * FROM expense_categories WHERE user_id = $1 AND LOWER(category_name) = LOWER($2)',
      [user_id, category_name.trim()]
    );

    if (categoryExists.rows.length > 0) {
      return res.status(400).json({ error: "Yeh category pehle se maujood hai!" });
    }

    const newCategory = await pool.query(
      'INSERT INTO expense_categories (user_id, category_name) VALUES ($1, $2) RETURNING *',
      [user_id, category_name.trim()]
    );

    res.status(201).json({ message: "Category added successfully!", category: newCategory.rows[0] });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. GET ALL USER CATEGORIES API
app.get('/api/categories/:user_id', async (req, res) => {
  const { user_id } = req.params;

  try {
    const categories = await pool.query(
      'SELECT * FROM expense_categories WHERE user_id = $1 ORDER BY category_name ASC',
      [user_id]
    );
    res.json(categories.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. DELETE EXPENSE CATEGORY API
app.delete('/api/categories/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const deleteOp = await pool.query('DELETE FROM expense_categories WHERE id = $1 RETURNING *', [id]);
    
    if (deleteOp.rows.length === 0) {
      return res.status(404).json({ error: "Category nahi mili!" });
    }

    res.json({ message: "Category successfully delete ho gayi!", deletedCategory: deleteOp.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================================
// 📈 BUDGETING & LIVE TRACKER APIS
// ========================================================

// 1. ASSIGN OR UPDATE BUDGET API
app.post('/api/budgets', async (req, res) => {
  const { user_id, category_name, amount } = req.body;

  if (!user_id || !category_name || !amount) {
    return res.status(400).json({ error: "Saare fields (User ID, Category, Amount) bharna zaroori hain!" });
  }

  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();

  try {
    const budgetQuery = await pool.query(
      `INSERT INTO monthly_budgets (user_id, category_name, amount, month, year)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ON CONSTRAINT unique_user_category_month
       DO UPDATE SET amount = EXCLUDED.amount
       RETURNING *`,
      [user_id, category_name, amount, currentMonth, currentYear]
    );

    res.status(200).json({ message: "Budget successfully assign ho gaya!", budget: budgetQuery.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. GET ALL USER BUDGETS FOR CURRENT MONTH
app.get('/api/budgets/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();

  try {
    const budgets = await pool.query(
      `SELECT * FROM monthly_budgets 
       WHERE user_id = $1 AND month = $2 AND year = $3 
       ORDER BY category_name ASC`,
      [user_id, currentMonth, currentYear]
    );
    res.json(budgets.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. DELETE BUDGET LIMIT API
app.delete('/api/budgets/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const deleteOp = await pool.query('DELETE FROM monthly_budgets WHERE id = $1 RETURNING *', [id]);
    if (deleteOp.rows.length === 0) {
      return res.status(404).json({ error: "Budget record nahi mila!" });
    }
    res.json({ message: "Budget successfully delete ho gaya!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. BUDGET LIVE TRACKER DATA ROUTE (Combines monthly_budgets & Exp_transactions)
app.get('/api/budget-tracker/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();

  try {
    const budgets = await pool.query(
      `SELECT category_name, amount FROM monthly_budgets 
       WHERE user_id = $1 AND month = $2 AND year = $3`,
      [user_id, currentMonth, currentYear]
    );

    const expenses = await pool.query(
      `SELECT category, SUM(amount) as total_spent FROM Exp_transactions 
       WHERE user_id = $1 AND UPPER(type) = 'OUTFLOW' 
       AND EXTRACT(MONTH FROM date) = $2 + 1 
       AND EXTRACT(YEAR FROM date) = $3
       GROUP BY category`,
      [user_id, currentMonth, currentYear]
    );

    const trackerData = budgets.rows.map(b => {
      const expenseObj = expenses.rows.find(e => e.category === b.category_name);
      const spent = expenseObj ? parseFloat(expenseObj.total_spent) : 0;
      const remaining = parseFloat(b.amount) - spent;
      return {
        category: b.category_name,
        limit: parseFloat(b.amount),
        spent: spent,
        remaining: remaining
      };
    });

    res.json(trackerData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SERVER LISTEN
app.listen(3000, () => {
  console.log('Server is Running on PORT 3000');
}); 