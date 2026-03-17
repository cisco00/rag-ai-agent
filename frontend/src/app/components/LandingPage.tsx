import { BarChart3, MessageSquare, Zap, Database, TrendingUp, Clock, Shield, Users, ArrowRight, CheckCircle, Sparkles } from 'lucide-react';

interface LandingPageProps {
  onGetStarted: () => void;
}

export function LandingPage({ onGetStarted }: LandingPageProps) {
  const features = [
    {
      icon: MessageSquare,
      title: 'Ask Questions, Get Answers',
      description: 'Simply type or speak your questions about your data in plain English. No technical knowledge required.',
      color: 'blue',
    },
    {
      icon: BarChart3,
      title: 'Instant Visualizations',
      description: 'See your data come to life with beautiful charts and graphs generated automatically from your questions.',
      color: 'purple',
    },
    {
      icon: Database,
      title: 'Connect Any Data Source',
      description: 'Upload Excel files, connect your database, or import CSV files. We support all major data formats.',
      color: 'green',
    },
    {
      icon: TrendingUp,
      title: 'Predict Future Trends',
      description: "Use advanced forecasting to see what's coming next. Make smarter decisions based on data predictions.",
      color: 'orange',
    },
    {
      icon: Clock,
      title: 'Automated Reports',
      description: 'Schedule reports to be sent automatically. Save time and keep everyone informed without lifting a finger.',
      color: 'red',
    },
    {
      icon: Zap,
      title: 'Real-Time Updates',
      description: 'Watch your data update live. Perfect for monitoring sales, website traffic, or any real-time metrics.',
      color: 'indigo',
    },
  ];

  const howItWorks = [
    {
      step: '1',
      title: 'Connect Your Data',
      description: 'Upload a spreadsheet or connect your database. It takes less than a minute.',
      icon: Database,
    },
    {
      step: '2',
      title: 'Ask Your Questions',
      description: 'Type or speak questions like "What were my top products last month?"',
      icon: MessageSquare,
    },
    {
      step: '3',
      title: 'Get Instant Insights',
      description: 'See answers with charts and visualizations. Share or export your findings.',
      icon: BarChart3,
    },
  ];

  const useCases = [
    {
      title: 'Sales Teams',
      description: 'Track performance, identify top sellers, and forecast revenue without spreadsheet formulas.',
    },
    {
      title: 'Business Owners',
      description: 'Understand your business metrics at a glance. Make data-driven decisions confidently.',
    },
    {
      title: 'Marketing Teams',
      description: 'Analyze campaign performance, customer behavior, and ROI with simple questions.',
    },
    {
      title: 'Operations',
      description: 'Monitor inventory, track efficiency, and spot issues before they become problems.',
    },
  ];

  const benefits = [
    'No coding or technical skills needed',
    'Works with Excel, CSV, and databases',
    'Voice-enabled for hands-free queries',
    'Share insights with your team instantly',
    'Automatic report scheduling',
    'Enterprise-grade security',
  ];

  const getColorClasses = (color: string) => {
    const colors: Record<string, string> = {
      blue: 'bg-blue-100 text-blue-600',
      purple: 'bg-purple-100 text-purple-600',
      green: 'bg-green-100 text-green-600',
      orange: 'bg-orange-100 text-orange-600',
      red: 'bg-red-100 text-red-600',
      indigo: 'bg-indigo-100 text-indigo-600',
    };
    return colors[color] || colors.blue;
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="border-b border-gray-200 bg-white sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <BarChart3 className="size-8 text-blue-600" />
              <span className="text-2xl font-bold text-gray-900">Vantage AI</span>
            </div>
            <button
              onClick={onGetStarted}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Get Started
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
        <div className="max-w-7xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-full text-sm font-medium mb-6">
            <Sparkles className="size-4" />
            Analytics Made Simple
          </div>
          
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
            Turn Your Data Into Insights
            <br />
            <span className="text-blue-600">Without Learning Complex Tools</span>
          </h1>
          
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            Vantage AI lets you analyze your business data by simply asking questions in plain English. 
            No spreadsheets, no formulas, no technical expertise required.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <button
              onClick={onGetStarted}
              className="px-8 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium text-lg flex items-center justify-center gap-2"
            >
              Start Free Trial
              <ArrowRight className="size-5" />
            </button>
            <button className="px-8 py-4 bg-white border-2 border-gray-300 text-gray-900 rounded-xl hover:border-gray-400 transition-colors font-medium text-lg">
              Watch Demo
            </button>
          </div>

          <div className="relative max-w-5xl mx-auto">
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 p-8">
              <div className="aspect-video bg-gradient-to-br from-blue-100 to-purple-100 rounded-xl flex items-center justify-center">
                <div className="text-center">
                  <BarChart3 className="size-24 text-blue-600 mx-auto mb-4" />
                  <p className="text-2xl font-bold text-gray-900">Your Analytics Dashboard</p>
                  <p className="text-gray-600 mt-2">Beautiful visualizations, instant insights</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Everything You Need to Understand Your Data</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">Powerful analytics features that anyone can use, no training required.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <div key={index} className="p-6 rounded-2xl border-2 border-gray-200 hover:border-blue-300 hover:shadow-lg transition-all">
                  <div className={`inline-flex p-3 rounded-xl ${getColorClasses(feature.color)} mb-4`}>
                    <Icon className="size-6" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-3">{feature.title}</h3>
                  <p className="text-gray-600">{feature.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Get Started in 3 Simple Steps</h2>
            <p className="text-xl text-gray-600">From data to insights in minutes, not hours.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {howItWorks.map((item, index) => {
              const Icon = item.icon;
              return (
                <div key={index} className="relative">
                  <div className="bg-white p-8 rounded-2xl border-2 border-gray-200 shadow-sm">
                    <div className="w-12 h-12 bg-blue-600 text-white rounded-xl flex items-center justify-center text-2xl font-bold mb-6">{item.step}</div>
                    <Icon className="size-12 text-blue-600 mb-4" />
                    <h3 className="text-2xl font-bold text-gray-900 mb-3">{item.title}</h3>
                    <p className="text-gray-600 text-lg">{item.description}</p>
                  </div>
                  {index < howItWorks.length - 1 && (
                    <div className="hidden md:block absolute top-1/2 -right-4 transform -translate-y-1/2">
                      <ArrowRight className="size-8 text-blue-600" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Built for Every Team</h2>
            <p className="text-xl text-gray-600">Whether you're in sales, marketing, or operations, Vantage AI works for you.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {useCases.map((useCase, index) => (
              <div key={index} className="p-8 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200">
                <h3 className="text-2xl font-bold text-gray-900 mb-3">{useCase.title}</h3>
                <p className="text-gray-700 text-lg">{useCase.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gray-50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Why Choose Vantage AI?</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {benefits.map((benefit, index) => (
              <div key={index} className="flex items-center gap-3 bg-white p-4 rounded-xl border border-gray-200">
                <CheckCircle className="size-6 text-green-600 flex-shrink-0" />
                <span className="text-lg text-gray-900">{benefit}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-blue-600 to-indigo-700">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">Ready to Transform Your Data Into Insights?</h2>
          <p className="text-xl text-blue-100 mb-8">Join thousands of teams who've simplified their analytics with Vantage AI.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <button onClick={onGetStarted} className="px-8 py-4 bg-white text-blue-600 rounded-xl hover:bg-gray-100 transition-colors font-medium text-lg flex items-center justify-center gap-2">
              Start Your Free Trial <ArrowRight className="size-5" />
            </button>
          </div>
          <p className="text-blue-100">No credit card required • Free 14-day trial • Cancel anytime</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="size-6 text-blue-500" />
                <span className="text-xl font-bold text-white">Vantage AI</span>
              </div>
              <p className="text-sm">Making analytics accessible to everyone, everywhere.</p>
            </div>
            <div>
              <h4 className="font-bold text-white mb-4">Product</h4>
              <ul className="space-y-2 text-sm">
                {['Features', 'Pricing', 'Demo', 'Updates'].map(l => <li key={l}><a href="#" className="hover:text-white transition-colors">{l}</a></li>)}
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-white mb-4">Company</h4>
              <ul className="space-y-2 text-sm">
                {['About Us', 'Careers', 'Blog', 'Contact'].map(l => <li key={l}><a href="#" className="hover:text-white transition-colors">{l}</a></li>)}
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-white mb-4">Legal</h4>
              <ul className="space-y-2 text-sm">
                {['Privacy Policy', 'Terms of Service', 'Security'].map(l => <li key={l}><a href="#" className="hover:text-white transition-colors">{l}</a></li>)}
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-8 text-sm text-center">
            <p>© 2026 Vantage AI. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}