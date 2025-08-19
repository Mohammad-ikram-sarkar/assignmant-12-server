const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const admin = require("firebase-admin");
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());


var serviceAccount = require("./firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


// Initialize Stripe
const stripe = require('stripe')(process.env.db_stripe_secret)

// MongoDB connection

const uri =  `mongodb+srv://${process.env.db_username}:${process.env.db_password}@cluster0.jiypkn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {

    const db = client.db('mydonation');
    const charityRoleRequests = db.collection('charity_role_request');
    const transactionHistory = db.collection('transactionHistory');
    const addDonationCollection = db.collection('addDonation')
    const charityRequestsCollection = db.collection('charityRequests')

    // custom middleware 
    const varifyFBToken =  async (req, res, next) => {
      const authHeader = req.headers['authorization'];
      if (!authHeader) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const token = authHeader.split(' ')[1];
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.user = decoded;
        next();
      } catch (error) {
        console.error('Error verifying token:', error);
        res.status(403).json({ message: 'Forbidden' });
      }
    }

    app.get('/donations' , async(req , res) => {
      const donations = await addDonationCollection.find().toArray();
      res.json(donations);
    })
  app.post('/charity/request', (req , res) => {
    const data = req.body;
    
 
    charityRequestsCollection.insertOne(data)
    .then(result => {
      res.status(201).json({ message: 'Charity request created', requestId: result.insertedId });
    })
    .catch(error => {
      console.error('Error creating charity request:', error);
      res.status(500).json({ error: 'Internal server error' });
    });
  })
  
    const userCollection = db.collection('users')

    
    app.post('/users' , async (req , res ) => {
      const {name , email , photo} = req.body
      try{
       const existingUser = await userCollection.findOne({email})
       if(existingUser) {
        return res.status(200).json({message : "User already exists" })
       }
       const result = await userCollection.insertOne({
        name,
        email,
        photo,
        role : 'user'
       })

      }catch(err) {
        return res.status(500).json({message:"Internal server error"})
      }
    })
    app.get('/users' , async(req , res) => {
      try {
        const users = await userCollection.find().toArray();
        res.json(users);
      } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    })

    app.get('/api/user/role' , (req, res) => {
      const {email } = req.query;
      if(!email) {
        return res.status(400).json({ message: 'Email is required' });
      }

      userCollection.findOne({ email })
        .then(user => {
          if (!user) {
            return res.status(404).json({ message: 'User not found' });
          }
          res.json({ role: user.role });
        })
        .catch(error => {
          console.error('Error fetching user role:', error);
          res.status(500).json({ error: 'Internal server error' });
        });
    })
    app.patch('/users/:id', async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    try {
        const result = await userCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { role } }
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({ message: 'User not found or role unchanged' });
        }

        res.json({ message: 'Role updated successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});
app.delete('/users/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await userCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});
app.get('/restaurant/request' , varifyFBToken, (req, res) => {
  const { email } = req.query;

  charityRequestsCollection.find({restaurantEmail : email, requestStatus: 'requested'})
  .toArray()
  .then(requests => {
    res.json(requests);
  })
  .catch(error => {
    console.error('Error fetching restaurant requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  });
});
app.put('/restaurant/request/:id', async (req, res) => {
  const { id } = req.params;
  const { requestStatus, charityEmail } = req.body;

  try {
    // Update the request status
    await charityRequestsCollection.updateOne(
      { donationId : id },
      { $set: { requestStatus } }
    );

    if (requestStatus === 'accepted') {
      await addDonationCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'accepted', charityEmail } }
      );
    }

    if (requestStatus === 'rejected') {
      await addDonationCollection.deleteOne({ donationId: id });
    }

    res.json({ message: 'Request status updated successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
app.get('/api/pickup' , async (req , res) => {
  const {email } = req.query;
  try{
    const requests = await addDonationCollection.find({charityEmail : email}).toArray();
    res.json(requests);
  }catch (error) {
    console.error('Error fetching pickup requests:', error);
    res.status(500).json({ error: 'Internal server error' });a
  }
})

    app.post('/charity/create-payment-intent', async (req, res) => {
      try {
        const { userEmail } = req.body;

        const paymentIntent = await stripe.paymentIntents.create({
          amount: 2500, // $25 in cents
          currency: 'usd',
          payment_method_types: ['card'],
          metadata: { userEmail, purpose: 'Charity Role Request' },
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error('Stripe error:', error);
        res.status(400).send({ error: error.message });
      }
    });

    // Save Charity Role Request
app.post('/apply/charity-request', async (req, res) => {
  try {
    const { userEmail, orgName, mission, transactionId } = req.body;
    console.log('Received /save-request payload:', { userEmail, orgName, mission, transactionId });

    // Validate required fields
    
   const result = await charityRoleRequests.insertOne({
    userEmail,
    orgName, 
    mission,
    transactionId,
    status : 'pending',
    createAt : new  Date()
   })


     await transactionHistory.insertOne({
          transactionId,
          amount: 25.0,
          date: new Date(),
          userEmail,
          purpose: 'Charity Role Request',
          status : 'pending'
        });
        res.json({ success: true });
    // Check if a pending or approved request already exists
  }catch (err) {
       console.error('Save request error:', error);
        res.status(500).json({ error: 'Internal server error' });

  }
});
app.get('/charity/request/donation', async (req, res) => {
  try {
    const requests = await addDonationCollection.find({status :"panding"}).toArray();
    res.json(requests);
  } catch (error) {
    console.error('Error fetching charity requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
app.delete('/charity/request/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await charityRequestsCollection.deleteOne({ donationId: id });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    res.json({ success: true, message: 'Charity request canceled' });
  } catch (error) {
    console.error('Error deleting charity request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
app.get('/charity/request/cancel', async (req, res) => {
  try {
    const requests = await charityRequestsCollection.find({requestStatus:'requested'}).toArray();
    res.json(requests);
  } catch (error) {
    console.error('Error fetching canceled charity requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

   app.get('/admin/approve-request', async (req , res) => {
    try {
      const requests = await charityRoleRequests.find({ status: 'pending' }).toArray();
      res.json(requests);
    } catch (error) {
      console.error('Error fetching approval requests:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
   })
app.post('/donation/post' , async(req , res) => {
  const {name , email , title, food , foodType ,quantity , pickupTime , location, image} = req.body;
  try{
    await addDonationCollection.insertOne({
      name ,
      email,
      title,
      food,
      foodType,
      quantity,
      pickupTime,
      location,
      image,
      status: 'panding',
      createAt: new Date()

    })
  }catch(err) {
    console.log(err)
  }

})
app.get('/my/donations', async (req, res) => {
  try {
    const { email } = req.query;
    const donations = await addDonationCollection.find({ email }).toArray();
    res.json(donations);
  } catch (err) {
    console.error('Error fetching donations:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
app.delete('/donation/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await addDonationCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Donation not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting donation:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
app.get('/all/donation', async (req, res) => {
  try {
    const donations = await addDonationCollection.find().toArray();
    res.json(donations);
  } catch (err) {
    console.error('Error fetching all donations:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
app.get('/user/show/status' , async(req , res ) => {

  try {
    const {email} = req.query;
    const transaction = await transactionHistory.findOne({userEmail : email})
    res.json(transaction)
   }catch (err) {
    console.error('Error fetching transaction:', err);
    res.status(500).json({ error: 'Internal server error' });
   }
  
})

  

app.get('/transaction/history' , async(req , res) => {
try {
    const {email} = req.query;
    const transaction = await transactionHistory.findOne({userEmail : email})
    res.json(transaction)
   }catch (err) {
    console.error('Error fetching transaction:', err);
    res.status(500).json({ error: 'Internal server error' });
   }
})
    await client.db('admin').command({ ping: 1 });
    console.log('Pinged your deployment. MongoDB connected successfully!');
  } catch (err) {
    console.error('MongoDB connection error:', err);
  }
}

run();

app.get('/', (req, res) => {
  res.send('Hello, server is running!');
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
