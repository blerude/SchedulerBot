var express = require('express');
var router = express.Router();
var models = require('../models');
var User = models.User;
var google = require('googleapis');
var OAuth2 = google.auth.OAuth2;

//////////////////////////////// PUBLIC ROUTES ////////////////////////////////
// Users who are not logged in can see these routes

var oauth2Client = new OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000'
);

router.get('/googleoauth', (req, res) => {
  console.log('ID', process.env.GOOGLE_CLIENT_ID);
  var url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/calendar'
    ],
    state: encodeURIComponent(JSON.stringify({
      auth_id: req.query.auth_id
    }))
  });
  console.log('URL', url);
  res.redirect(url);
})

router.get('/', (req, res) => {
  console.log('ID', req.query.state);
  oauth2Client.getToken(req.query.code, (err, tokens) => {
    // tokens contains an access_token and an optional refresh_token
    if (!err) {
      console.log('TOKEN', tokens);
      oauth2Client.setCredentials(tokens);
      Users.findById(JSON.parse(decodeURIComponent(req.query.state)))
        .then(user => {
          user.tokens = tokens;
          user.save().then(u => { console.log('SAVED', u) }).catch(err => { console.log('ERROR', err) });
        })
        .catch(err => {
          console.log('ERROR', err);
        })
    }
  });
})

// router.get('/', function(req, res) {
//   res.render('home');
// });
router.post('/interactive', (req, res) => {
  var string = JSON.parse(req.body.payload);
  console.log(req)
  User.findOne({slackId: string.user.id}, function(err, messager) {
    if (string.actions[0].value === 'cancel') {
      res.send('Scheduler cancelled');
    } else {
      var pending = JSON.parse(messager.pending)
      new Reminder({
        subject: pending.subject,
        date: pending.date,
        user: messager._id
      }).save()
      res.send('Meeting confirmed!')
    }
    messager.pending = '';
    messager.save();
  })
})


///////////////////////////// END OF PUBLIC ROUTES /////////////////////////////

// router.use(function(req, res, next){
//   if (!req.user) {
//     res.redirect('/login');
//   } else {
//     return next();
//   }
// });

//////////////////////////////// PRIVATE ROUTES ////////////////////////////////
// Only logged in users can see these routes

router.get('/protected', function(req, res, next) {
  res.render('protectedRoute', {
    username: req.user.username,
  });
});

///////////////////////////// END OF PRIVATE ROUTES /////////////////////////////

module.exports = router;
