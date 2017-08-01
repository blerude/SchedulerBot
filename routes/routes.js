var express = require('express');
var router = express.Router();
var models = require('../models');
var User = models.User;
var google = require('googleapis');
var OAuth2 = google.auth.OAuth2;
var axios = require('axios');

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
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/plus.me'
    ],
    state: encodeURIComponent(JSON.stringify({
      auth_id: req.query.auth_id,
      subject: req.query.subject,
      date: req.query.date
    }))
  });
  console.log('URL', url);
  res.redirect(url);
})

router.get('/', (req, res) => {
  console.log('ID', JSON.parse(decodeURIComponent(req.query.state)));
  oauth2Client.getToken(req.query.code, (err, tokens) => {
    // tokens contains an access_token and an optional refresh_token
    if (!err) {
      console.log('TOKEN', tokens);
      oauth2Client.setCredentials(tokens);
      User.findOne({ slackId: JSON.parse(decodeURIComponent(req.query.state)).auth_id })
        .then(user => {
          console.log('FOUND USER!', user);
          user.tokens = tokens;
          user.save()
            .then(user => {
              console.log('SAVED', user);
              var state = JSON.parse(decodeURIComponent(req.query.state));
              var startDate = new Date(state.date).getTime();
              var endDate = startDate + (24 * 60 * 60 * 1000);
              var event = {
                summary: state.subject,
                // location: '800 Howard St., San Francisco, CA 94103',
                // description: 'A chance to hear more about Google\'s developer products.',
                start: {
                  dateTime: new Date(startDate),
                  timeZone: 'America/Los_Angeles'
                },
                end: {
                  dateTime: new Date(endDate),
                  timeZone: 'America/Los_Angeles'
                }
              };

              var calendar = google.calendar('v3');
              calendar.events.insert({
                auth: oauth2Client,
                calendarId: 'primary',
                resource: event,
              }, function(err, e) {
                if (err) {
                  console.log('ERROR', err);
                  return;
                }
                console.log('Event created: %s', e.htmlLink);
                res.redirect('https://calendar.google.com/calendar');
              });
            })
        })
        .catch(err => {
          console.log('ERROR', err);
        })
      }
  });
})

router.post('/interactive', (req, res) => {
  console.log('IN INTERACTIVE');
  var string = JSON.parse(req.body.payload);
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
      console.log('CONFIRMED', pending);
      // if (messager.tokens) {
      //   res.redirect('http://localhost:3000/');
      // } else {
      res.send(`http://localhost:3000/googleoauth?auth_id=${string.user.id}&subject=${pending.subject}&date=${pending.date}`);
      // }
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
