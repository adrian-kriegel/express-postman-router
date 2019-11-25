## WARNING
This is an early bodgy version of what I had in mind. Use with care.

## express-postman-router
Create automatically documented & secured API calls.

```
npm install adrian-kriegel/express-postman-router
```

This module wraps around express and the Postman API. The API documentation can be written in code and linked up to a Postman collection. This means that your API docs will be 100% accurate. 
By using JSON schemata, you can define which parameters are required and how they are supposed to be structured before any of your callbacks are executed.

## Example

```javascript

const pr = require("express-postman-router")

//define some options that we can use in multiple instances of PostmanRouter later on
pr.options('myapi', 
{
	host: 'localhost',
	protocol: 'http',
	mountpath: '/',
	postman: 
	{
		apikey: "<YOUR POSTMAN API KEY>",
		collection_uid: "<YOUR POSTMAN COLLECTION ID>"
	}
})

//set up the PostmanRouter with the previously defined options
const api = new pr.PostmanRouter({use: 'myapi'})

//add a new documented route to our api
api.add(
{
	name: 'login',	//name of the api call
	description: 'Login with your email and password', //description of the api call
	
	params: //let's define the parameters for documentation & validation
	{
		email: //use a JSON schema here. You may add the fields 'required' and 'description' to it
		{
			required: true,	//this parameter is required
			description: 'The email assiciated with the users account', //parameter description
			type: 'string', //parameter type. 
			pattern: emailRegex	//check email via regex
		},
		password:
		{
			required: true,
			type: 'string'
		}
	},
	method: 'POST',	//the request method this api call will answer to
	route: '/test/login', //the route relative to the routers mountpath
	
	//finally, what to do (only) if the parameters match the documentation above
	callback: (req, res, next) =>
	{
		res.send("OK") //do whatever in here
	}
})

//update the postman collection.
api.updatePostman()

//connect it up to our express app
app.use(api.getRouter())


```
