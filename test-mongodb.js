/**
 * MongoDB Connection Test Script
 * Run this to verify your MongoDB connection is working
 * Usage: node test-mongodb.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');

console.log('🔍 Testing MongoDB Connection...\n');

// Check if .env file exists
const fs = require('fs');
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
    console.error('❌ ERROR: .env file not found!');
    console.log('📝 Please create a .env file from .env.example:');
    console.log('   cp .env.example .env');
    console.log('   Then edit .env and add your MongoDB connection string\n');
    process.exit(1);
}

// Check if MONGODB_URI is set
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
    console.error('❌ ERROR: MONGODB_URI not set in .env file!');
    console.log('📝 Please add your MongoDB connection string to .env:');
    console.log('   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/gdg_quiz\n');
    process.exit(1);
}

console.log('✅ .env file found');
console.log('✅ MONGODB_URI is set');
console.log(`📊 Connection string: ${MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}\n`);

// Test connection
console.log('🔌 Attempting to connect to MongoDB...\n');

mongoose.connect(MONGODB_URI)
    .then(async () => {
        console.log('✅ Successfully connected to MongoDB!');
        console.log(`📊 Database name: ${mongoose.connection.name}`);
        console.log(`🌐 Host: ${mongoose.connection.host}\n`);

        // Test creating a document
        console.log('📝 Testing document creation...');
        
        const testSchema = new mongoose.Schema({
            test: String,
            timestamp: { type: Date, default: Date.now }
        });
        const TestModel = mongoose.model('connection_test', testSchema);
        
        const testDoc = new TestModel({ test: 'Connection test successful' });
        await testDoc.save();
        
        console.log('✅ Test document created successfully!');
        
        // Clean up test document
        await TestModel.deleteMany({ test: 'Connection test successful' });
        console.log('🧹 Test document cleaned up\n');
        
        console.log('🎉 All tests passed! Your MongoDB connection is working correctly.');
        console.log('✨ You can now start your quiz application with: npm start\n');
        
        await mongoose.connection.close();
        process.exit(0);
    })
    .catch(err => {
        console.error('❌ MongoDB connection failed!\n');
        console.error('Error details:', err.message);
        console.log('\n📋 Common issues and solutions:');
        console.log('1. Wrong username or password → Check your database user in MongoDB Atlas');
        console.log('2. IP not whitelisted → Add your IP in Network Access settings');
        console.log('3. Invalid connection string → Verify the format in your .env file');
        console.log('4. Special characters in password → URL-encode them (see MONGODB_SETUP.md)');
        console.log('\n📖 For detailed setup instructions, see MONGODB_SETUP.md\n');
        process.exit(1);
    });

// Handle timeout
setTimeout(() => {
    console.error('❌ Connection timeout after 10 seconds');
    console.log('This usually means:');
    console.log('- Your IP address is not whitelisted in MongoDB Atlas');
    console.log('- Network connectivity issues');
    console.log('- Firewall blocking the connection\n');
    process.exit(1);
}, 10000);
